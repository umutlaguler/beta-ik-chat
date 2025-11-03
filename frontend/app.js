const { useEffect, useRef, useState } = React;

let CONFIG = { brand: "Beta Enerji • İK Chat", links: {}, whitelist: [] };
let SSS_TR = [];
let SSS_EN = [];

function useAutoScroll(dep) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [dep]);
  return ref;
}

async function loadConfig() {
  const [cfg, tr, en] = await Promise.all([
    fetch("./config.json").then((r) => r.json()),
    fetch("./sss.tr.json").then((r) => r.json()),
    fetch("./sss.en.json").then((r) => r.json()).catch(() => []),
  ]);
  CONFIG = cfg;
  SSS_TR = tr;
  SSS_EN = en;
}

const SENSITIVE =
  /(maaş|salary|pazarlık|hamile|dini|yaş|vize|oturum|mülakat soruları)/i;
function preGuard(userText) {
  if (SENSITIVE.test(userText)) {
    const c = CONFIG.links?.contact || "https://betaenerji.com/iletisim";
    return `Bu konu özel değerlendirme/hukuki danışmanlık gerektirebilir. Resmî bilgi için İK: ${c}`;
  }
  return null;
}

function sanitizeLinks(text) {
  if (!text || typeof text !== "string") return ""; // 💥 Hata önleyici eklendi

  const WL = CONFIG.whitelist || [];
  const isOk = (url) => WL.some((rx) => new RegExp(rx, "i").test(url));

  // 1) Markdown link
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (m, label, url) => (isOk(url) ? m : `${label} [link kaldırıldı]`)
  );

  // 2) Düz URL
  text = text.replace(
    /(https?:\/\/\S+?)([),.;!?]*)(\s|$)/g,
    (m, url, trail, end) =>
      (isOk(url) ? url : "[link kaldırıldı]") + (trail || "") + (end || "")
  );

  return text;
}


function applyCanonicalFacts(text) {
  const size = CONFIG?.facts?.facility_size_m2;
  if (size && /m²/i.test(text) && /tesis|fabrika|alan/i.test(text)) {
    text = text.replace(/\b\d{1,3}(\.\d{3})*(\s*m²)/g, size);
  }
  return text;
}

// ✅ Artık sadece backend'e istek atan temiz fonksiyon
async function askBackend(userText) {
  const res = await fetch("http://127.0.0.1:3001/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: userText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Bilinmeyen hata oluştu");
  if (!data.answer) throw new Error("Boş yanıt döndü");
  return data.answer;
}


function App() {
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Merhaba! İK asistanıyım. Nasıl yardımcı olabilirim?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useAutoScroll([messages, busy]);

  useEffect(() => {
    loadConfig().then(() => setReady(true));
  }, []);

  async function send() {
    const text = input.trim();
    if (!text) return;

    // pre-guard
    const blocked = preGuard(text);
    if (blocked) {
      setMessages((m) => [
        ...m,
        { role: "user", content: text },
        { role: "assistant", content: blocked },
      ]);
      setInput("");
      return;
    }

    // kullanıcı mesajını ekle
    const historyLocal = [...messages, { role: "user", content: text }];
    setMessages(historyLocal);
    setInput("");
    setBusy(true);

    try {
      const reply = await askBackend(text);
      const fixed = applyCanonicalFacts(reply);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: sanitizeLinks(fixed) },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Hata: ${e.message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!ready)
    return React.createElement("div", { className: "app" }, "Yükleniyor...");

  return (
    <div className="app">
      <header className="header">
        <h1>{CONFIG.brand}</h1>
        <div className="small">
          Başvurular için: {CONFIG?.links?.careers_tr} • Staj:{" "}
          {CONFIG?.links?.intern_tr}
        </div>
      </header>

      <main ref={chatRef} className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <div className="bubble">Yazıyor…</div>
          </div>
        )}
      </main>

      <div className="inputBar">
        <div className="row">
          <input
            type="text"
            placeholder="Sorunuzu yazın…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
          />
          <button onClick={send} disabled={busy}>
            Gönder
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
