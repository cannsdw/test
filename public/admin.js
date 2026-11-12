const $=s=>document.querySelector(s);
const won=n=>new Intl.NumberFormat("ko-KR").format(n)+"원";
async function api(url,opts={}){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opts});const d=await r.json();if(!r.ok)throw Error(d.error||"요청 실패");return d}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function showDashboard(){ $("#loginPanel").classList.add("hidden");$("#dashboard").classList.remove("hidden");refresh();}
async function refresh(){
 try{
  const d=await api("/api/admin/stats");
  $("#available").textContent=d.available;$("#sold").textContent=d.sold;$("#orders").textContent=d.orders.length;
  $("#productForm").elements.price.value=d.product.price;
  $("#productForm").elements.active.checked=!!d.product.active;
  $("#orderList").innerHTML=d.orders.length?d.orders.map(o=>`<div class="order-row"><div><strong>${esc(o.order_no)}</strong><p>${esc(o.buyer_name)} · ${esc(o.email)} ${o.buyer_phone?"· "+esc(o.buyer_phone):""}</p><p>${won(o.amount)} · ${esc(o.created_at)} · 상태: ${o.status==="paid"?"입금 확인 완료":o.status==="cancelled"?"취소":"입금 대기"}</p></div><div class="order-actions">${o.status==="pending"?`<button class="primary" data-confirm="${o.id}">입금 확인 및 코드 배정</button><button class="secondary" data-cancel="${o.id}">취소</button>`:""}</div></div>`).join(""):'<p class="admin-table-note">아직 주문이 없습니다.</p>';
 }catch(e){$("#loginMsg").textContent=e.message;}
}
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();$("#loginMsg").textContent="";try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:new FormData(e.target).get("password")})});showDashboard();}catch(err){$("#loginMsg").textContent=err.message;$("#loginMsg").className="error";}});
$("#productForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("/api/admin/product",{method:"POST",body:JSON.stringify({price:Number(f.get("price")),active:f.get("active")==="on"})});$("#productMsg").textContent="상품 설정을 저장했습니다.";$("#productMsg").className="success";refresh();}catch(err){$("#productMsg").textContent=err.message;$("#productMsg").className="error";}});
$("#importForm").addEventListener("submit",async e=>{e.preventDefault();const codes=new FormData(e.target).get("codes");if(!confirm("입력한 코드를 재고에 등록할까요?"))return;try{const d=await api("/api/admin/codes/import",{method:"POST",body:JSON.stringify({codes})});$("#importMsg").textContent=`등록 ${d.added}개 · 중복 ${d.duplicates}개 · 붙여넣기 내 중복 ${d.duplicateLinesInPaste}개`;$("#importMsg").className="success";e.target.reset();refresh();}catch(err){$("#importMsg").textContent=err.message;$("#importMsg").className="error";}});
$("#orderList").addEventListener("click",async e=>{
 const confirmId=e.target.dataset.confirm, cancelId=e.target.dataset.cancel;
 if(confirmId){if(!confirm("실제 은행 입금 내역을 확인했나요? 승인하면 CDK가 즉시 주문에 배정됩니다."))return;try{const d=await api(`/api/admin/orders/${confirmId}/confirm-payment`,{method:"POST"});alert(d.message);refresh();}catch(err){alert(err.message);}}
 if(cancelId){if(!confirm("이 주문을 취소할까요?"))return;try{await api(`/api/admin/orders/${cancelId}/cancel`,{method:"POST"});refresh();}catch(err){alert(err.message);}}
});
$("#logout").addEventListener("click",async()=>{try{await api("/api/admin/logout",{method:"POST"});}finally{location.reload();}});
(async()=>{try{await api("/api/admin/stats");showDashboard();}catch{}})();
