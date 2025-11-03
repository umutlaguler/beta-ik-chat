import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import OpenAI from "openai";

dotenv.config();
console.log("🔑 API Key var mı?", !!process.env.OPENAI_API_KEY);

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(bodyParser.json());

// ✅ Dosya yollarını Render için düzelt
const CONFIG = JSON.parse(fs.readFileSync("./backend/config.json", "utf8"));
const SSS_TR = JSON.parse(fs.readFileSync("./backend/sss.tr.json", "utf8"));

// ✅ OpenAI istemcisi
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🛰️ Basit log
app.use((req, res, next) => {
  console.log("🛰️ İstek geldi:", req.method, req.url);
  next();
});

// ✅ API endpointleri
app.get("/api/config", (req, res) => res.json(CONFIG));
app.get("/api/sss", (req, res) => res.json(SSS_TR));

// --- Embedding Cache
let embeddingsCache = [];

async function generateEmbeddings() {
  console.log("🧠 Embedding'ler oluşturuluyor...");
  embeddingsCache = await Promise.all(
    SSS_TR.map(async (item) => {
      const emb = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: item.q,
      });
      return { ...item, vector: emb.data[0].embedding };
    })
  );
  console.log("✅ SSS embedding'leri hazır (" + embeddingsCache.length + ")");
}

function cosineSim(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (magA * magB);
}

async function findFAQ(question) {
  if (!embeddingsCache.length) await generateEmbeddings();

  const qEmb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: question,
  });
  const vector = qEmb.data[0].embedding;

  let best = null;
  let bestScore = 0;

  for (const item of embeddingsCache) {
    const score = cosineSim(vector, item.vector);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  console.log(`🔍 En yüksek benzerlik: ${bestScore.toFixed(2)}`);
  return bestScore > 0.8 ? best : null;
}

// --- Ana endpoint
app.post("/api/ask", async (req, res) => {
  try {
    const { text } = req.body;
    console.log("📩 Gelen soru:", text);

    if (!text) return res.status(400).json({ error: "Soru metni boş olamaz." });

    const faq = await findFAQ(text);
    if (faq) {
      console.log("📗 Eşleşen SSS bulundu:", faq.q);
      return res.json({ answer: faq.a, source: "sss" });
    }

    console.log("🟡 OpenAI fallback başlatılıyor...");

    const factsText = Object.entries(CONFIG.facts)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("; ");

    const systemPrompt = `
Sen Beta Enerji'nin dijital insan kaynakları asistanısın.
Kullanıcılara işe alım, staj, başvuru süreci, mülakat, özgeçmiş ve şirket hakkında rehberlik yaparsın.
Amacın, onlara profesyonel bir dille yardımcı olmak, motive etmek ve yönlendirme sağlamaktır.

Aşağıda Beta Enerji’ye ait doğrulanmış bilgiler bulunmaktadır:
${factsText}

Kuralların:
1. Şirketle ilgili kesin verilerde bu bilgileri kullan.
2. Kariyer, mülakat, özgeçmiş gibi konularda rehberlik et.
3. Empatik, samimi ama profesyonel konuş.
4. Bilgi yoksa yönlendir: ${CONFIG.links.contact}.
5. Cevap 2–4 cümle arası, doğal Türkçe olmalı.
`;

    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.3,
      max_tokens: 250,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || "Yanıt alınamadı.";

    res.json({ answer, source: "openai" });
  } catch (e) {
    console.error("🔥 Sunucu hatası:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- 🔥 Render’a özel: 0.0.0.0 binding
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend çalışıyor: http://0.0.0.0:${PORT}`);
});
