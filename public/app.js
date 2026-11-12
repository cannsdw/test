const $ = s => document.querySelector(s);
const won = n => new Intl.NumberFormat("ko-KR").format(n) + "원";
let product = null;
async function api(url, options={}) {
  const response = await fetch(url,{headers:{"Content-Type":"application/json"},...options});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
async function loadProduct(){
  try {
    product=await api("/api/product");
    $("#productName").textContent=product.name;
    $("#productDescription").textContent=product.description;
    $("#productPrice").textContent=product.price>0?won(product.price):"판매 준비 중";
    $("#shopStatus").textContent=product.active?"AVAILABLE NOW":"CURRENTLY IN PREPARATION";
    $("#buyButton").disabled=!product.active;
    $("#buyButton").textContent=product.active?"BUY NOW ↗":"COMING SOON";
    $("#productNote").textContent=product.active?`현재 재고 ${product.stock}개 · 계좌이체 후 관리자 입금 확인이 완료되면 코드가 발급됩니다.`:"관리자가 가격·계좌·재고 및 판매 조건을 설정하면 구매할 수 있습니다.";
  } catch(e) { $("#productNote").textContent="상품 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."; }
}
$("#buyButton").addEventListener("click",()=>{$("#checkoutPanel").classList.remove("hidden");$("#checkoutPanel").scrollIntoView({behavior:"smooth",block:"start"});});
$("#checkoutForm").addEventListener("submit",async e=>{
 e.preventDefault(); const result=$("#checkoutResult"); result.innerHTML="주문을 생성하고 있습니다...";
 const payload=Object.fromEntries(new FormData(e.target).entries());
 try {
  const d=await api("/api/orders",{method:"POST",body:JSON.stringify(payload)});
  result.innerHTML=`<div class="order-confirm"><div class="eyebrow">ORDER CREATED</div><h3>${escapeHtml(d.orderNo)}</h3><p>${escapeHtml(d.productName)} · <strong>${won(d.amount)}</strong></p><p>은행: ${escapeHtml(d.bank.bankName)}<br>계좌번호: ${escapeHtml(d.bank.account)}<br>예금주: ${escapeHtml(d.bank.holder)}</p><p class="notice">입금자명은 주문 시 입력한 이름과 동일하게 해 주세요. 입금 확인 전에는 코드가 발급되지 않습니다. 주문번호와 PIN을 안전하게 보관하세요.</p><button type="button" class="primary" id="copyOrder">주문번호 복사</button></div>`;
  $("#copyOrder").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(d.orderNo);$("#copyOrder").textContent="복사 완료";}catch{ $("#copyOrder").textContent=d.orderNo; }});
  e.target.reset(); result.scrollIntoView({behavior:"smooth",block:"center"});
 } catch(err) { result.innerHTML=`<p class="error">${escapeHtml(err.message)}</p>`; }
});
$("#lookupForm").addEventListener("submit",async e=>{
 e.preventDefault(); const result=$("#lookupResult"); result.textContent="조회 중...";
 try {
  const payload=Object.fromEntries(new FormData(e.target).entries());
  const d=await api("/api/order-lookup",{method:"POST",body:JSON.stringify(payload)});
  const o=d.order;
  result.innerHTML=`<div class="order-confirm"><div class="eyebrow">ORDER STATUS</div><h3>${escapeHtml(o.order_no)}</h3><p>${escapeHtml(o.product_name)} · ${won(o.amount)}</p><p>상태: <strong>${o.status==="paid"?"입금 확인 완료":o.status==="cancelled"?"주문 취소":"입금 확인 대기"}</strong></p><p>${escapeHtml(d.message)}</p>${d.code?`<div class="code-box"><small>YOUR DIGITAL CODE</small><strong>${escapeHtml(d.code)}</strong></div>`:""}</div>`;
 } catch(err) { result.innerHTML=`<p class="error">${escapeHtml(err.message)}</p>`; }
});
loadProduct();
