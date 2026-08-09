const KEY="packcheck-v1";
const DEFAULT_CATS=["Clothes","Toiletries","Electronics","Documents","Baby","Essentials","Car","Food","Other"];
let db=load();
let verifying=false, verifyQueue=[], verifyIndex=0;

function load(){try{return JSON.parse(localStorage.getItem(KEY))||{trip:null,categories:DEFAULT_CATS,items:[]}}catch{return{trip:null,categories:DEFAULT_CATS,items:[]}}}
function save(){localStorage.setItem(KEY,JSON.stringify(db))}
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function status(i){if(i.verified)return"verified";if(i.attention)return"attention";if(i.packed)return"packed";return"todo"}
function statusLabel(s){return{verified:"Verified",attention:"Needs attention",packed:"Packed",todo:"To pack"}[s]}
function canVerify(){if(!db.trip?.date)return false;const trip=new Date(db.trip.date+"T00:00:00");const today=new Date();today.setHours(0,0,0,0);return Math.ceil((trip-today)/86400000)<=1}
function render(){
  document.getElementById("tripSetup").classList.toggle("hidden",!!db.trip);
  document.getElementById("dashboard").classList.toggle("hidden",!db.trip);
  if(!db.trip)return;
  document.getElementById("tripTitle").textContent=db.trip.name;
  const counts={verified:0,packed:0,attention:0,total:db.items.length};
  db.items.forEach(i=>{const s=status(i);if(s==="verified")counts.verified++;if(s==="packed")counts.packed++;if(s==="attention")counts.attention++});
  ["verifiedCount","packedCount","attentionCount","totalCount"].forEach((k,j)=>document.getElementById(k).textContent=[counts.verified,counts.packed,counts.attention,counts.total][j]);
  const ready=counts.total>0&&counts.verified===counts.total;
  const r=document.getElementById("readiness");
  r.className="readiness card "+(ready?"ready":"not-ready");
  r.innerHTML=ready?"🎉 PACKING COMPLETE — everything is verified.":`⚠️ NOT READY — ${counts.total-counts.verified} item${counts.total-counts.verified===1?"":"s"} still need verification.`;
  const vb=document.getElementById("verifyBtn");
  vb.disabled=!canVerify();vb.title=canVerify()?"":"Verification opens only on the trip date or the day before.";
  vb.textContent=canVerify()?"Start verification":"Verification locked until 1 day before";
  renderCategories();
}
function renderCategories(){
  const filter=document.getElementById("filter").value;
  const root=document.getElementById("categories");root.innerHTML="";
  for(const cat of db.categories){
    const items=db.items.filter(i=>i.category===cat&&(filter==="all"||status(i)===filter));
    if(!items.length)continue;
    const d=document.createElement("details");d.className="category";d.open=true;
    d.innerHTML=`<summary>${esc(cat)} <span class="cat-meta">${items.length}</span></summary>`;
    items.forEach(i=>{
      const s=status(i);
      const tags=(i.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("");
      const qty=i.qty?`Qty ${i.qty}`:"";
      const sub=[qty,tags].filter(Boolean).join(" · ");
      d.insertAdjacentHTML("beforeend",`<div class="item">
        <input type="checkbox" ${i.packed||i.verified?"checked":""} ${i.verified?"disabled":""} aria-label="Pack ${esc(i.name)}" onchange="togglePacked('${i.id}',this.checked)">
        <div class="item-main"><div class="item-name">${esc(i.name)}</div><div class="item-sub">${sub}</div></div>
        <span class="status s-${s}">${statusLabel(s)}</span>
        <button class="item-menu" onclick="editItem('${i.id}')" aria-label="Edit">⋯</button>
      </div>`);
    });
    root.appendChild(d);
  }
  if(!root.children.length)root.innerHTML='<div class="empty">No items match this filter.</div>';
}
function togglePacked(id,checked){
  const i=db.items.find(x=>x.id===id);if(!i)return;
  i.packed=checked;i.attention=false;if(!checked)i.verified=false;
  save();render();
}
function openItem(id=null){
  document.getElementById("editId").value=id||"";
  document.getElementById("itemDialogTitle").textContent=id?"Edit item":"Add item";
  const i=id&&db.items.find(x=>x.id===id);
  document.getElementById("itemName").value=i?.name||"";
  document.getElementById("itemQty").value=i?.qty||"";
  document.getElementById("itemTags").value=(i?.tags||[]).join(", ");
  document.getElementById("itemCategory").innerHTML=db.categories.map(c=>`<option ${c===(i?.category||db.categories[0])?"selected":""}>${esc(c)}</option>`).join("");
  document.getElementById("itemDialog").showModal();
}
function editItem(id){openItem(id)}
document.getElementById("itemForm").addEventListener("submit",e=>{
  e.preventDefault();
  const id=document.getElementById("editId").value;
  const obj={name:document.getElementById("itemName").value.trim(),category:document.getElementById("itemCategory").value,qty:Number(document.getElementById("itemQty").value)||null,tags:document.getElementById("itemTags").value.split(",").map(x=>x.trim()).filter(Boolean)};
  if(!obj.name)return;
  if(id)Object.assign(db.items.find(x=>x.id===id),obj);else db.items.push({id:uid(),...obj,packed:false,verified:false,attention:false});
  save();document.getElementById("itemDialog").close();render();
});
document.getElementById("addItemBtn").onclick=()=>openItem();
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
document.getElementById("filter").onchange=renderCategories;
document.getElementById("saveTrip").onclick=()=>{
  const name=document.getElementById("tripName").value.trim()||"My Trip",date=document.getElementById("tripDate").value;
  if(!date){alert("Choose a trip date.");return}
  db.trip={name,date};save();render();
};
document.getElementById("newTripBtn").onclick=()=>{
  if(confirm("Start a new trip? Your current list will be replaced. You can duplicate lists in a future version.")){
    db.trip=null;db.items=[];save();render();
  }
};
document.getElementById("verifyBtn").onclick=startVerification;
function startVerification(){
  if(!canVerify())return;
  verifyQueue=db.items.filter(i=>i.packed&&!i.verified);
  verifyIndex=0;
  if(!verifyQueue.length){alert("Nothing is waiting for verification.");return}
  verifying=true;showVerification();
}
function showVerification(){
  if(verifyIndex>=verifyQueue.length){document.getElementById("verifyDialog").close();verifying=false;render();alert("Verification complete.");return}
  const i=verifyQueue[verifyIndex];
  document.getElementById("verifyItemName").textContent=i.name;
  document.getElementById("verifyDetails").textContent=`${i.category}${i.qty?" · Quantity: "+i.qty:""}${i.tags?.length?" · "+i.tags.join(", "):""}`;
  document.getElementById("verifyDialog").showModal();
}
document.getElementById("verified").onclick=()=>{
  const i=verifyQueue[verifyIndex];i.verified=true;i.attention=false;i.verifiedAt=new Date().toISOString();save();verifyIndex++;showVerification();
};
document.getElementById("notFound").onclick=()=>{
  const i=verifyQueue[verifyIndex];i.verified=false;i.attention=true;save();verifyIndex++;showVerification();
};
document.getElementById("stopVerify").onclick=()=>{verifying=false;document.getElementById("verifyDialog").close();render()};
document.getElementById("manageCategories").onclick=()=>{
  const list=document.getElementById("categoryList");list.innerHTML=db.categories.map(c=>`<div class="cat-actions"><strong>${esc(c)}</strong> <button type="button" class="danger" onclick="removeCategory('${esc(c)}')">Delete</button></div>`).join("");
  document.getElementById("categoryDialog").showModal();
};
function removeCategory(c){
  if(db.categories.length===1){alert("Keep at least one category.");return}
  if(db.items.some(i=>i.category===c)){alert("Move or delete the items in this category first.");return}
  db.categories=db.categories.filter(x=>x!==c);save();
  document.getElementById("categoryDialog").close();render();
}
document.getElementById("categoryForm").addEventListener("submit",e=>{
  e.preventDefault();const c=document.getElementById("newCategory").value.trim();if(!c)return;
  if(!db.categories.includes(c))db.categories.push(c);document.getElementById("newCategory").value="";save();document.getElementById("categoryDialog").close();render();
});
render();
