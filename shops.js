const grid=document.querySelector('#shops'),count=document.querySelector('#shop-count'),canvasLink=document.querySelector('#canvas-link'),wardrobeLink=document.querySelector('#wardrobe-link'),toggle=document.querySelector('#add-toggle'),form=document.querySelector('#shop-form'),cancel=document.querySelector('#cancel-add'),urlInput=document.querySelector('#shop-url'),nameInput=document.querySelector('#shop-name'),toast=document.querySelector('#toast');
const routeUserId=location.pathname.split('/').filter(Boolean)[0]||'441294944';
const userId=/^[a-zA-Z0-9_-]{1,64}$/.test(routeUserId)?routeUserId:'441294944';
const endpoint=`/api/shops?user_id=${encodeURIComponent(userId)}`;
let shops=[],timer;
document.title=`Shops / ${userId}`;canvasLink.href=`/${encodeURIComponent(userId)}`;wardrobeLink.href=`/${encodeURIComponent(userId)}/list`;

function message(value){clearTimeout(timer);toast.textContent=value;toast.classList.add('show');timer=setTimeout(()=>toast.classList.remove('show'),2400)}
async function api(options={}){const response=await fetch(endpoint,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`HTTP_${response.status}`);return body}
function monogram(name){return String(name||'S').split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}
function shopCard(shop,index){
  const article=document.createElement('article');article.className='shop-card';
  const top=document.createElement('div');top.className='card-top';top.innerHTML=`<span>${String(index+1).padStart(2,'0')}</span><span>${shop.manual?'SAVED':'FROM WARDROBE'}</span>`;
  const visual=document.createElement('div');visual.className='shop-visual';
  if(shop.images?.length){for(const source of shop.images){const image=document.createElement('img');image.src=source;image.alt='';image.loading='lazy';visual.append(image)}}else{const mark=document.createElement('strong');mark.textContent=monogram(shop.name);visual.append(mark)}
  const copy=document.createElement('div');copy.className='shop-copy';const heading=document.createElement('h2');heading.textContent=shop.name;const domain=document.createElement('p');domain.textContent=shop.domain;copy.append(heading,domain);
  const footer=document.createElement('div');footer.className='card-footer';const products=document.createElement('span');products.textContent=`${shop.product_count} PRODUCT${shop.product_count===1?'':'S'}`;const actions=document.createElement('div');actions.className='card-actions';
  if(shop.manual){const remove=document.createElement('button');remove.type='button';remove.textContent='REMOVE';remove.addEventListener('click',()=>removeShop(shop));actions.append(remove)}
  const visit=document.createElement('a');visit.href=shop.url;visit.target='_blank';visit.rel='noopener noreferrer';visit.textContent='VISIT ↗';actions.append(visit);footer.append(products,actions);article.append(top,visual,copy,footer);return article
}
function render(){count.textContent=`${shops.length} SHOP${shops.length===1?'':'S'}`;grid.replaceChildren(...(shops.length?shops.map(shopCard):[Object.assign(document.createElement('p'),{className:'empty',textContent:'NO SHOPS YET · ADD ONE ABOVE'})]))}
function setForm(open){form.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'× CLOSE':'+ ADD SHOP';if(open)requestAnimationFrame(()=>urlInput.focus())}
async function load(){try{const result=await api();shops=result.shops||[];render()}catch{grid.innerHTML='<p class="empty">SHOPS COULD NOT LOAD</p>'}}
async function removeShop(shop){if(!confirm(`Remove ${shop.name} from saved shops? Products from this shop will still keep it in the directory.`))return;try{const result=await api({method:'DELETE',body:JSON.stringify({id:shop.id})});shops=result.shops||[];render();message('SHOP REMOVED')}catch{message('REMOVE FAILED')}}
toggle.addEventListener('click',()=>setForm(form.hidden));cancel.addEventListener('click',()=>setForm(false));
form.addEventListener('submit',async event=>{event.preventDefault();const submit=form.querySelector('.submit');submit.disabled=true;try{const result=await api({method:'POST',body:JSON.stringify({url:urlInput.value.trim(),name:nameInput.value.trim()})});shops=result.shops||[];urlInput.value='';nameInput.value='';setForm(false);render();message('SHOP SAVED')}catch(error){message(error.message==='INVALID_SHOP_URL'?'ENTER A VALID SHOP URL':'SAVE FAILED')}finally{submit.disabled=false}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')setForm(false)});
load();
