import express from "express";
import axios from "axios";
import mongoose from "mongoose";
import cron from "node-cron";

/* ===== CONFIG ===== */
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID  = process.env.CHAT_ID;
const MONGO_URI = process.env.MONGO_URI;

/* ===== DB CONNECT ===== */
await mongoose.connect(MONGO_URI);

/* ===== SCHEMAS ===== */
const Result = mongoose.model("Result",{
  period:{type:String,unique:true},
  number:Number,
  bigSmall:String,
  color:String,
  time:{type:Date,default:Date.now}
});

const Pattern = mongoose.model("Pattern",{
  type:String,
  sequence:String,
  occurred:{type:Number,default:0},
  success:{type:Number,default:0}
});

const Prediction = mongoose.model("Prediction",{
  period:String,
  prediction:String,
  confidence:Number,
  status:String,
  time:{type:Date,default:Date.now}
});

/* ===== UTILS ===== */
const BS = n => n >= 5 ? "B" : "S";

function classify(seq){
  if(/^(BS)+B?$|^(SB)+S?$/.test(seq)) return "Alternating";
  if(/BBB|SSS/.test(seq)) return "Stable";
  if(/BBBS|SSSB/.test(seq)) return "Break-Breaker";
  return "Mixed";
}

async function sendTelegram(text){
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{
    chat_id: CHAT_ID,
    text
  });
}

/* ===== ENGINE ===== */
async function engine(){
  const res = await axios.get(API_URL);
  const latest = res.data.data.list[0];

  /* duplicate period check */
  if(await Result.findOne({period:latest.issueNumber})) return;

  const number = Number(latest.number);
  const bs = BS(number);

  /* save result */
  await Result.create({
    period: latest.issueNumber,
    number,
    bigSmall: bs==="B"?"Big":"Small",
    color: latest.color
  });

  /* last 4 pattern */
  const last4 = await Result.find().sort({time:-1}).limit(4);
  const seq = last4.map(r=>r.bigSmall[0]).join("");
  const type = classify(seq);

  let pattern = await Pattern.findOne({type,sequence:seq});
  if(!pattern){
    pattern = await Pattern.create({type,sequence:seq});
  }
  pattern.occurred++;
  await pattern.save();

  /* prediction */
  let prediction="WAIT";
  let confidence=0;
  let status="NOT_ALLOWED";

  if(type==="Break-Breaker" && pattern.occurred>=3){
    prediction = seq.startsWith("BBB") ? "BIG" : "SMALL";
    confidence = Math.max(
      60,
      Math.round((pattern.success / pattern.occurred) * 100) || 60
    );
    status="ALLOWED";
  }

  await Prediction.create({
    period: latest.issueNumber,
    prediction,
    confidence,
    status
  });

  /* telegram log */
  await sendTelegram(
`📊 Result
Period: ${latest.issueNumber}
Number: ${number}
Big/Small: ${bs==="B"?"Big":"Small"}
Color: ${latest.color}

🧠 Learning
Pattern: ${type}
Sequence: ${seq}
Occurred: ${pattern.occurred}

🔮 Prediction
Decision: ${prediction}
Confidence: ${confidence}%
Status: ${status}`
  );

  console.log("Saved:",latest.issueNumber);
}

/* ===== CRON (every 1 sec) ===== */
cron.schedule("*/1 * * * * *",engine);

/* ===== API (optional) ===== */
const app = express();

app.get("/",(req,res)=>res.send("Wingo backend running"));
app.get("/api/live",async(req,res)=>{
  res.json(await Result.find().sort({time:-1}).limit(20));
});
app.get("/api/prediction",async(req,res)=>{
  res.json(await Prediction.find().sort({time:-1}).limit(1));
});

app.listen(3000,()=>console.log("Server running on 3000"));
