const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const app = express();
// Render terminates HTTPS at its proxy. Trust the proxy so secure session cookies work.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_PATH || "rush-shop.sqlite");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
 price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS codes (
 id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
 code_hash TEXT NOT NULL UNIQUE, code_iv TEXT NOT NULL, code_tag TEXT NOT NULL,
 code_ciphertext TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available',
 order_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY, order_no TEXT NOT NULL UNIQUE, product_id INTEGER NOT NULL,
 buyer_name TEXT NOT NULL, email TEXT NOT NULL, amount INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', code_id INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY, event TEXT NOT NULL, detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const columns = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
if (!columns.includes("lookup_pin_hash")) db.exec("ALTER TABLE orders ADD COLUMN lookup_pin_hash TEXT");
if (!columns.includes("buyer_phone")) db.exec("ALTER TABLE orders ADD COLUMN buyer_phone TEXT");
if (!db.prepare("SELECT id FROM products WHERE id=1").get()) {
  db.prepare("INSERT INTO products(id,name,description,price,active) VALUES(1,?,?,?,0)")
    .run("PUBG 11,200 G-COIN CDK", "디지털 코드 상품입니다. 지원 지역과 사용 조건을 구매 전에 확인해 주세요.", 0);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "rush_admin",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 2*60*60*1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const requireAdmin = (req,res,next) => req.session.admin ? next() : res.status(401).json({error:"관리자 로그인이 필요합니다."});
const audit = db.prepare("INSERT INTO audit_log(event,detail) VALUES(?,?)");
const hashCode = value => crypto.createHash("sha256").update(value).digest("hex");
const hashPin = pin => crypto.scryptSync(String(pin), process.env.PIN_SALT || process.env.SESSION_SECRET || "rush-pin-salt", 32).toString("hex");
function safeEqual(a,b) {
  const aa=Buffer.from(String(a)); const bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function encryptionKey() {
  const raw = process.env.CDK_ENCRYPTION_KEY;
  if (!raw || !/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error("CDK_ENCRYPTION_KEY 환경변수를 64자리 16진수로 설정해야 합니다.");
  return Buffer.from(raw, "hex");
}
function encryptCode(code) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
}
function decryptCode(row) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.code_iv, "hex"));
  decipher.setAuthTag(Buffer.from(row.code_tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(row.code_ciphertext, "hex")), decipher.final()]).toString("utf8");
}
function publicBankInfo() {
  return { bankName: process.env.BANK_NAME || "관리자 계좌 정보 준비 중", account: process.env.BANK_ACCOUNT || "", holder: process.env.BANK_HOLDER || "" };
}
function makeOrderNo() { return "RUSH-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase(); }

app.get("/api/product", (req,res) => {
 const p = db.prepare("SELECT id,name,description,price,active FROM products WHERE id=1").get();
 const stock = db.prepare("SELECT count(*) n FROM codes WHERE product_id=1 AND status='available'").get().n;
 const bankConfigured=!!(process.env.BANK_NAME && process.env.BANK_ACCOUNT && process.env.BANK_HOLDER);
 res.json({...p, active:!!p.active && p.price>0 && stock>0 && bankConfigured, stock, bankConfigured});
});

// 계좌이체 주문: 결제 승인이 아닌 '입금 대기' 주문만 생성합니다.
app.post("/api/orders", (req,res) => {
 const p = db.prepare("SELECT id,name,price,active FROM products WHERE id=1").get();
 const stock = db.prepare("SELECT count(*) n FROM codes WHERE product_id=1 AND status='available'").get().n;
 if (!p || !p.active || p.price<=0) return res.status(403).json({error:"현재 상품 판매가 준비되지 않았습니다."});
 const pending = db.prepare("SELECT count(*) n FROM orders WHERE product_id=1 AND status='pending'").get().n;
 if (stock-pending<1) return res.status(409).json({error:"현재 주문 가능한 수량이 없습니다. 재고 또는 미입금 주문을 확인해 주세요."});
 if (!process.env.BANK_NAME || !process.env.BANK_ACCOUNT || !process.env.BANK_HOLDER) return res.status(503).json({error:"관리자 계좌 정보가 아직 설정되지 않았습니다."});
 const name=String(req.body?.name||"").trim();
 const email=String(req.body?.email||"").trim().toLowerCase();
 const phone=String(req.body?.phone||"").trim();
 const pin=String(req.body?.lookupPin||"").trim();
 if(name.length<2 || name.length>40) return res.status(400).json({error:"이름을 2~40자로 입력해 주세요."});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"올바른 이메일을 입력해 주세요."});
 if(!/^[0-9]{4,8}$/.test(pin)) return res.status(400).json({error:"주문 조회 PIN은 숫자 4~8자리로 설정해 주세요."});
 if(phone.length>30) return res.status(400).json({error:"연락처 형식을 확인해 주세요."});
 const orderNo=makeOrderNo();
 const result=db.prepare(`INSERT INTO orders(order_no,product_id,buyer_name,email,buyer_phone,amount,status,lookup_pin_hash)
 VALUES(?,?,?,?,?,?, 'pending',?)`).run(orderNo,p.id,name,email,phone,p.price,hashPin(pin));
 audit.run("order_created",`order=${orderNo}; amount=${p.price}`);
 res.status(201).json({orderNo,amount:p.price,productName:p.name,status:"pending",bank:publicBankInfo(),message:"입금 확인 후 관리자가 승인하면 코드가 자동 배정됩니다."});
});

// 주문번호 + 이메일 + 주문 시 만든 PIN을 모두 확인해야 주문 상세/코드를 볼 수 있습니다.
app.post("/api/order-lookup", (req,res) => {
 const orderNo=String(req.body?.orderNo||"").trim().toUpperCase();
 const email=String(req.body?.email||"").trim().toLowerCase();
 const pin=String(req.body?.lookupPin||"").trim();
 const order=db.prepare(`SELECT o.*,p.name AS product_name FROM orders o JOIN products p ON p.id=o.product_id WHERE o.order_no=? AND o.email=?`).get(orderNo,email);
 if(!order || !order.lookup_pin_hash || !safeEqual(order.lookup_pin_hash,hashPin(pin))) return res.status(404).json({error:"주문 정보를 확인할 수 없습니다. 주문번호, 이메일, PIN을 확인해 주세요."});
 let code=null;
 if(order.status==="paid" && order.code_id) {
   const row=db.prepare("SELECT * FROM codes WHERE id=? AND order_id=?").get(order.code_id,order.id);
   if(row) code=decryptCode(row);
 }
 res.json({order:{order_no:order.order_no,product_name:order.product_name,amount:order.amount,status:order.status,created_at:order.created_at},code,message:order.status==="paid"?"입금 확인이 완료되었습니다. 아래 발급 코드를 사용하세요.":"아직 입금 확인 전입니다. 입금 후 관리자 확인을 기다려 주세요."});
});

app.post("/api/admin/login", (req,res) => {
 const expected = process.env.ADMIN_PASSWORD;
 if (!expected) return res.status(503).json({error:"Render 환경변수 ADMIN_PASSWORD를 설정해야 합니다."});
 if (!safeEqual(String(req.body?.password || ""),expected)) return res.status(401).json({error:"비밀번호가 올바르지 않습니다."});
 req.session.admin = true;
 audit.run("admin_login","관리자 로그인 성공");
 // Send the response only after the session has been saved to the session store.
 req.session.save(err => {
   if (err) return res.status(500).json({error:"관리자 로그인 세션 저장에 실패했습니다."});
   res.json({ok:true});
 });
});
app.post("/api/admin/logout", requireAdmin, (req,res) => req.session.destroy(()=>res.json({ok:true})));

app.get("/api/admin/stats", requireAdmin, (req,res) => {
 const available = db.prepare("SELECT count(*) n FROM codes WHERE status='available'").get().n;
 const sold = db.prepare("SELECT count(*) n FROM codes WHERE status='sold'").get().n;
 const orders = db.prepare(`SELECT id,order_no,buyer_name,email,buyer_phone,amount,status,created_at FROM orders ORDER BY id DESC LIMIT 100`).all();
 const product=db.prepare("SELECT id,name,description,price,active FROM products WHERE id=1").get();
 res.json({available,sold,orders,product});
});
app.post("/api/admin/product", requireAdmin, (req,res) => {
 const price=Number(req.body?.price);
 const active=!!req.body?.active;
 if(!Number.isSafeInteger(price) || price<0 || price>100000000) return res.status(400).json({error:"상품 가격을 올바르게 입력해 주세요."});
 if(active && price<=0) return res.status(400).json({error:"판매 활성화 전 상품 가격을 설정해 주세요."});
 const stock=db.prepare("SELECT count(*) n FROM codes WHERE product_id=1 AND status='available'").get().n;
 if(active && stock<1) return res.status(400).json({error:"판매 활성화 전에 CDK 재고를 1개 이상 등록해 주세요."});
 db.prepare("UPDATE products SET price=?,active=? WHERE id=1").run(price,active?1:0);
 audit.run("product_updated",`price=${price}; active=${active}`);
 res.json({ok:true});
});

// 관리자 입금 확인: 단일 DB 트랜잭션으로 주문 승인과 코드 배정을 함께 처리합니다.
app.post("/api/admin/orders/:id/confirm-payment", requireAdmin, (req,res) => {
 let key; try { key=encryptionKey(); } catch(e) { return res.status(503).json({error:e.message}); }
 const tx=db.transaction((id) => {
   const order=db.prepare("SELECT * FROM orders WHERE id=?").get(id);
   if(!order) throw new Error("주문을 찾을 수 없습니다.");
   if(order.status==="paid" && order.code_id) return {already:true,orderNo:order.order_no};
   if(order.status!=="pending") throw new Error("입금 대기 상태의 주문만 승인할 수 있습니다.");
   const code=db.prepare("SELECT * FROM codes WHERE product_id=? AND status='available' ORDER BY id LIMIT 1").get(order.product_id);
   if(!code) throw new Error("사용 가능한 재고가 없습니다. 재고를 먼저 등록해 주세요.");
   db.prepare("UPDATE codes SET status='sold',order_id=? WHERE id=? AND status='available'").run(order.id,code.id);
   db.prepare("UPDATE orders SET status='paid',code_id=? WHERE id=? AND status='pending'").run(code.id,order.id);
   audit.run("payment_confirmed",`order=${order.order_no}; code_id=${code.id}`);
   return {already:false,orderNo:order.order_no};
 });
 try { const result=tx(Number(req.params.id)); res.json({ok:true,...result,message:result.already?"이미 승인된 주문입니다.":"입금 승인 및 코드 배정이 완료되었습니다."}); }
 catch(e) { res.status(400).json({error:e.message}); }
});
app.post("/api/admin/orders/:id/cancel", requireAdmin, (req,res) => {
 const order=db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
 if(!order) return res.status(404).json({error:"주문을 찾을 수 없습니다."});
 if(order.status!=="pending") return res.status(400).json({error:"입금 대기 주문만 취소할 수 있습니다."});
 db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(order.id);
 audit.run("order_cancelled",`order=${order.order_no}`);
 res.json({ok:true});
});

app.post("/api/admin/codes/import", requireAdmin, (req,res) => {
 try { encryptionKey(); } catch(e) { return res.status(503).json({error:e.message}); }
 const lines = String(req.body?.codes || "").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if (!lines.length) return res.status(400).json({error:"등록할 코드를 입력해 주세요."});
 if (lines.length > 5000) return res.status(413).json({error:"한 번에 최대 5,000개까지 등록할 수 있습니다."});
 const insert = db.prepare(`INSERT OR IGNORE INTO codes (product_id,code_hash,code_iv,code_tag,code_ciphertext,status) VALUES(1,?,?,?,?, 'available')`);
 const tx = db.transaction(items => {
   let added=0, duplicates=0;
   for (const code of items) {
     const enc = encryptCode(code);
     const result = insert.run(hashCode(code), enc.iv, enc.tag, enc.ciphertext);
     if (result.changes) added++; else duplicates++;
   }
   return {added,duplicates};
 });
 try {
   const unique = [...new Set(lines)]; const result = tx(unique);
   audit.run("inventory_import",`added=${result.added}, duplicates=${result.duplicates}`);
   res.json({...result,blankLinesIgnored:0,duplicateLinesInPaste:lines.length-unique.length});
 } catch(e) { res.status(500).json({error:"재고 등록 실패. 암호화 키 설정을 확인하세요."}); }
});
app.get("/api/admin/codes", requireAdmin, (req,res) => {
 const rows = db.prepare("SELECT status,count(*) AS count FROM codes GROUP BY status").all();
 res.json({counts:rows});
});
app.get("/api/admin/audit", requireAdmin, (req,res) => {
 res.json(db.prepare("SELECT event,detail,created_at FROM audit_log ORDER BY id DESC LIMIT 100").all());
});
app.listen(PORT, () => console.log(`RUSH SHOP running at http://localhost:${PORT}`));
