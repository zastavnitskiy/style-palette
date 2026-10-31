import { uniqueProducts } from '/catalog.mjs';

const table=document.querySelector('#catalog'),count=document.querySelector('#item-count'),canvasLink=document.querySelector('#canvas-link'),shopsLink=document.querySelector('#shops-link'),toast=document.querySelector('#toast');
const routeUserId=location.pathname.split('/').filter(Boolean)[0]||'441294944';
const userId=/^[a-zA-Z0-9_-]{1,64}$/.test(routeUserId)?routeUserId:'441294944';
const endpoint=`/api/palette?user_id=${encodeURIComponent(userId)}`;
const categories=[['outerwear','OUTERWEAR'],['tops','TOPS'],['bottoms','BOTTOMS'],['footwear','FOOTWEAR'],['bags','BAGS'],['accessories','ACCESSORIES'],['other','OTHER']];
const statuses=[['owned','OWNED'],['to_buy','TO BUY'],['other','OTHER']];
let timer;
document.title=`Wardrobe / ${userId}`;canvasLink.href=`/${encodeURIComponent(userId)}`;shopsLink.href=`/${encodeURIComponent(userId)}/shops`;

function message(value){clearTimeout(timer);toast.textContent=value;toast.classList.add('show');timer=setTimeout(()=>toast.classList.remove('show'),2200)}
function optionList(values,current){return values.map(([value,label])=>`<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('')}
function cell(tag,className){const node=document.createElement(tag);if(className)node.className=className;return node}
async function save(item,row){const category=row.querySelector('[name="category"]').value,price=row.querySelector('[name="price"]').value.trim(),currency=row.querySelector('[name="currency"]').value.trim().toUpperCase(),wardrobe_status=row.querySelector('[name="wardrobe_status"]').value;row.dataset.saving='true';try{const response=await fetch(endpoint,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,catalog:{category,price,currency,wardrobe_status}})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`HTTP_${response.status}`);message('ITEM SAVED')}catch{message('SAVE FAILED')}finally{delete row.dataset.saving}}
function rowFor(item){
  const row=document.createElement('tr');row.dataset.catalogId=item.catalog_id||item.id;
  const thumbCell=cell('td'),thumb=cell('div',`thumb ${item.status||''}`);if(item.status==='ready'&&item.image_url){const image=document.createElement('img');image.src=item.image_url;image.alt='';image.loading='lazy';thumb.append(image)}thumbCell.append(thumb);
  const nameCell=cell('td','name');nameCell.textContent=item.title||'UNTITLED';if(item.status!=='ready'){const process=cell('span','process');process.textContent=item.status==='failed'?'PROCESSING FAILED':'PROCESSING';nameCell.append(process)}
  const categoryCell=cell('td'),category=document.createElement('select');category.name='category';category.setAttribute('aria-label',`Category for ${item.title}`);category.innerHTML=optionList(categories,item.category||'other');categoryCell.append(category);
  const priceCell=cell('td'),priceFields=cell('div','price-fields'),price=document.createElement('input'),currency=document.createElement('input');price.name='price';price.inputMode='decimal';price.placeholder='PRICE';price.value=item.price??'';price.setAttribute('aria-label',`Price for ${item.title}`);currency.name='currency';currency.className='currency';currency.maxLength=8;currency.placeholder='EUR';currency.value=item.currency??'';currency.setAttribute('aria-label',`Currency for ${item.title}`);priceFields.append(price,currency);priceCell.append(priceFields);
  const linkCell=cell('td'),link=document.createElement('a');link.className=`source${item.source_url?'':' disabled'}`;link.textContent='↗';link.setAttribute('aria-label',item.source_url?`Open ${item.title}`:'No product link');if(item.source_url){link.href=item.source_url;link.target='_blank';link.rel='noopener noreferrer'}linkCell.append(link);
  const statusCell=cell('td'),status=document.createElement('select');status.name='wardrobe_status';status.setAttribute('aria-label',`Status for ${item.title}`);status.innerHTML=optionList(statuses,item.wardrobe_status||'other');statusCell.append(status);
  row.append(thumbCell,nameCell,categoryCell,priceCell,linkCell,statusCell);
  row.addEventListener('change',()=>save(item,row));
  return row;
}
async function load(){try{const response=await fetch(endpoint,{credentials:'same-origin'}),state=await response.json();if(!response.ok)throw new Error();const products=uniqueProducts(state.items||[]);count.textContent=`${products.length} ITEM${products.length===1?'':'S'}`;table.replaceChildren(...(products.length?products.map(rowFor):[Object.assign(cell('tr'),{innerHTML:'<td colspan="6" class="empty">NO ITEMS YET</td>'})]));if(products.some(item=>item.status==='pending'))setTimeout(load,3500)}catch{table.innerHTML='<tr><td colspan="6" class="empty">WARDROBE COULD NOT LOAD</td></tr>'}}
load();
