const palette=document.querySelector('#palette'),scene=document.querySelector('#scene'),selectionControls=document.querySelector('#selection-controls'),addButton=document.querySelector('#add-button'),listButton=document.querySelector('#list-button'),shopButton=document.querySelector('#shop-button'),intake=document.querySelector('#intake'),intakeClose=document.querySelector('#intake-close'),input=document.querySelector('#product-input'),priceInput=document.querySelector('#price-input'),currencyInput=document.querySelector('#currency-input'),toast=document.querySelector('#toast');
const routeUserId=location.pathname.split('/').filter(Boolean)[0]||'441294944';
const userId=/^[a-zA-Z0-9_-]{1,64}$/.test(routeUserId)?routeUserId:'441294944';
const endpoint=`/api/palette?user_id=${encodeURIComponent(userId)}`;
let state={items:[]},selectedId=null,gesture=null,toastTimer,pollTimer,canvasGesture=null;
const touchPoints=new Map(),viewport={x:0,y:0,scale:1};
document.title=`Palette / ${userId}`;
listButton.href=`/${encodeURIComponent(userId)}/list`;
shopButton.href=`/${encodeURIComponent(userId)}/shops`;

function message(text){clearTimeout(toastTimer);toast.textContent=text;toast.classList.add('show');toastTimer=setTimeout(()=>toast.classList.remove('show'),3200)}
async function api(options={}){const response=await fetch(endpoint,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`HTTP_${response.status}`);return body}
function applyVisualTransform(element,item){element.style.setProperty('--rotation',`${item.rotation||0}deg`);element.style.setProperty('--mirror',item.mirror?-1:1)}
function controls(){return '<button type="button" class="rotate-handle" data-action="rotate" aria-label="Rotate item">↻</button><button type="button" class="layer-handle" data-action="layer" aria-label="Drag up or down to change layer">≡</button><button type="button" class="resize-handle" data-action="resize" aria-label="Resize item">↘</button>'}
function itemNode(item){
  const article=document.createElement('article'),visual=document.createElement('div');article.className=`object ${item.status||'ready'}${item.id===selectedId?' selected':''}`;visual.className='object-visual';article.dataset.id=item.id;article.style.left=`${item.x*100}%`;article.style.top=`${item.y*100}%`;article.style.width=`${item.width*100}%`;article.style.zIndex=item.z||1;applyVisualTransform(article,item);
  if(item.status==='ready'&&item.image_url){const image=document.createElement('img');image.src=item.image_url;image.alt=item.title||'Palette item';image.draggable=false;visual.append(image)}
  else{const pending=document.createElement('div'),spinner=document.createElement('i'),strong=document.createElement('strong'),small=document.createElement('small');pending.className='pending-card';spinner.className='pending-spinner';spinner.setAttribute('aria-hidden','true');strong.textContent=item.title||'NEW ITEM';small.textContent=item.status==='failed'?'COULD NOT PROCESS':'PREPARING CUTOUT';pending.append(spinner,strong,small);visual.append(pending)}
  article.append(visual);
  const label=document.createElement(item.source_url?'a':'span');label.className='object-label';label.textContent=`${item.title||'UNTITLED'}${item.source_url?' ↗':''}`;if(item.source_url){label.href=item.source_url;label.target='_blank';label.rel='noopener noreferrer'}article.append(label);article.insertAdjacentHTML('beforeend',controls());return article
}
function render(){scene.replaceChildren(...state.items.map(itemNode));selectionControls.hidden=!selectedId;clearTimeout(pollTimer);if(state.items.some(item=>item.status==='pending'))pollTimer=setTimeout(load,3500)}
async function load(){try{state=await api();if(!state.items.some(item=>item.id===selectedId))selectedId=null;render()}catch{message('PALETTE COULD NOT LOAD')}}
function itemById(id){return state.items.find(item=>item.id===id)}
function select(id){selectedId=id;render()}
async function persist(item,fields){try{const result=await api({method:'PATCH',body:JSON.stringify({id:item.id,...fields})});Object.assign(item,result.item)}catch{message('CHANGE NOT SAVED')}}
function applyViewport(){const grid=matchMedia('(max-width:600px)').matches?32:48;scene.style.transform=`translate3d(${viewport.x}px,${viewport.y}px,0) scale(${viewport.scale})`;palette.style.backgroundPosition=`${viewport.x}px ${viewport.y}px`;palette.style.backgroundSize=`${grid*viewport.scale}px ${grid*viewport.scale}px`}
function previewLayer(order,id,target){const ids=order.filter(value=>value!==id),position=Math.min(ids.length,Math.max(0,target));ids.splice(position,0,id);ids.forEach((value,index)=>{const item=itemById(value),element=scene.querySelector(`[data-id="${CSS.escape(value)}"]`);if(item)item.z=index+1;if(element)element.style.zIndex=index+1});return position}
function pairMetrics(ids){const [a,b]=ids.map(id=>touchPoints.get(id));return{centerX:(a.x+b.x)/2,centerY:(a.y+b.y)/2,distance:Math.hypot(b.x-a.x,b.y-a.y)||1}}
function beginCanvasGesture(){
  const ids=[...touchPoints.keys()].slice(0,2),metrics=pairMetrics(ids);
  if(gesture){const{item,type,x,y,width,rotation,element,startOrder,layerIndex}=gesture;if(type==='move'){item.x=x;item.y=y;element.style.left=`${x*100}%`;element.style.top=`${y*100}%`}if(type==='resize'){item.width=width;element.style.width=`${width*100}%`}if(type==='rotate'){item.rotation=rotation;applyVisualTransform(element,item)}if(type==='layer')previewLayer(startOrder,item.id,layerIndex);gesture=null}
  const worldX=(metrics.centerX-viewport.x)/viewport.scale,worldY=(metrics.centerY-viewport.y)/viewport.scale;
  canvasGesture={ids,startDistance:metrics.distance,startScale:viewport.scale,worldX,worldY};
}

palette.addEventListener('pointerdown',event=>{
  if(event.pointerType==='touch'){touchPoints.set(event.pointerId,{x:event.clientX,y:event.clientY});if(touchPoints.size>=2){beginCanvasGesture();event.preventDefault();return}}
  const object=event.target.closest('.object');if(!object){select(null);return}const item=itemById(object.dataset.id);if(!item)return;
  if(selectedId!==item.id){selectedId=item.id;render()}
  const current=palette.querySelector(`[data-id="${CSS.escape(item.id)}"]`),action=event.target.closest('[data-action]')?.dataset.action;
  if(['back','down','up','front','mirror','copy','remove'].includes(action)||event.target.closest('.object-label'))return;
  const rect=current.getBoundingClientRect(),startOrder=[...state.items].sort((a,b)=>(a.z||0)-(b.z||0)).map(entry=>entry.id),layerIndex=startOrder.indexOf(item.id);gesture={type:action||'move',item,element:current,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:item.x,y:item.y,width:item.width,rotation:item.rotation||0,centerX:rect.left+rect.width/2,centerY:rect.top+rect.height/2,startOrder,layerIndex,layerPosition:layerIndex};current.setPointerCapture(event.pointerId);event.preventDefault()
});
palette.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'&&touchPoints.has(event.pointerId))touchPoints.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(canvasGesture&&canvasGesture.ids.every(id=>touchPoints.has(id))){const metrics=pairMetrics(canvasGesture.ids);viewport.scale=Math.min(3,Math.max(.5,canvasGesture.startScale*metrics.distance/canvasGesture.startDistance));viewport.x=metrics.centerX-canvasGesture.worldX*viewport.scale;viewport.y=metrics.centerY-canvasGesture.worldY*viewport.scale;applyViewport();event.preventDefault();return}
  if(!gesture||gesture.pointerId!==event.pointerId)return;const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
  if(gesture.type==='move'){gesture.item.x=gesture.x+dx/(palette.clientWidth*viewport.scale);gesture.item.y=gesture.y+dy/(palette.clientHeight*viewport.scale);gesture.element.style.left=`${gesture.item.x*100}%`;gesture.element.style.top=`${gesture.item.y*100}%`}
  else if(gesture.type==='resize'){gesture.item.width=Math.min(.8,Math.max(.05,gesture.width+dx/(palette.clientWidth*viewport.scale)));gesture.element.style.width=`${gesture.item.width*100}%`}
  else if(gesture.type==='rotate'){gesture.item.rotation=Math.round(Math.atan2(event.clientY-gesture.centerY,event.clientX-gesture.centerX)*180/Math.PI+90);applyVisualTransform(gesture.element,gesture.item)}
  else if(gesture.type==='layer'){const steps=Math.round((gesture.startY-event.clientY)/36);gesture.layerPosition=previewLayer(gesture.startOrder,gesture.item.id,gesture.layerIndex+steps)}
});
async function endGesture(event){if(!gesture||gesture.pointerId!==event.pointerId)return;const{item,type,layerPosition}=gesture;gesture=null;if(type==='move')await persist(item,{x:item.x,y:item.y});if(type==='resize')await persist(item,{width:item.width});if(type==='rotate')await persist(item,{rotation:item.rotation});if(type==='layer'){try{const result=await api({method:'PATCH',body:JSON.stringify({id:item.id,layer_position:layerPosition})});state.items=result.items;render();message('LAYER UPDATED')}catch{message('LAYER CHANGE FAILED')}}}
async function endPointer(event){touchPoints.delete(event.pointerId);if(canvasGesture&&touchPoints.size<2){canvasGesture=null;gesture=null;return}await endGesture(event)}
palette.addEventListener('pointerup',endPointer);palette.addEventListener('pointercancel',endPointer);
document.addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action,clickedObject=event.target.closest('.object');if(!action)return;const item=itemById(clickedObject?.dataset.id||selectedId);if(!item)return;const object=palette.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if(['back','down','up','front'].includes(action)){try{const result=await api({method:'PATCH',body:JSON.stringify({id:item.id,layer:action})});state.items=result.items;render();message(action==='front'?'BROUGHT TO FRONT':action==='back'?'SENT TO BACK':action==='up'?'MOVED UP':'MOVED DOWN')}catch{message('LAYER CHANGE FAILED')}}
  if(action==='mirror'){item.mirror=!item.mirror;applyVisualTransform(object,item);await persist(item,{mirror:item.mirror})}
  if(action==='copy'){try{const result=await api({method:'POST',body:JSON.stringify({copy_id:item.id})});state.items.push(result.item);selectedId=result.item.id;render();message('ITEM COPIED')}catch{message('COPY FAILED')}}
  if(action==='remove'&&confirm(`Remove ${item.title}?`)){try{await api({method:'DELETE',body:JSON.stringify({id:item.id})});state.items=state.items.filter(entry=>entry.id!==item.id);selectedId=null;render();message('ITEM REMOVED')}catch{message('REMOVE FAILED')}}
});
function setIntake(open){intake.hidden=!open;addButton.hidden=open;addButton.setAttribute('aria-expanded',String(open));if(open){select(null);requestAnimationFrame(()=>input.focus())}else input.blur()}
addButton.addEventListener('click',()=>setIntake(true));intakeClose.addEventListener('click',()=>setIntake(false));
intake.addEventListener('submit',async event=>{
  event.preventDefault();const value=input.value.trim(),price=priceInput.value.trim(),currency=currencyInput.value.trim().toUpperCase();if(!value)return;const submit=intake.querySelector('[type="submit"]');submit.disabled=true;
  try{const result=await api({method:'POST',body:JSON.stringify({input:value,price,currency})});state.items.push(result.item);input.value='';priceInput.value='';setIntake(false);selectedId=result.item.id;render();message('ADDED · PROCESSING IN BACKGROUND')}
  catch(error){message(`ADD FAILED · ${error.message}`)}finally{submit.disabled=false}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){setIntake(false);select(null)}});
addEventListener('resize',applyViewport);
load();
