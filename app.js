(() => {
  const seed = window.FAMILY_SEED || {nodes:[],relationships:[],roots:[]};
  const KEY='our-family-root-v1.15-family-units';
  // The project file is the source of truth. Browser storage is only a temporary safety copy.
  let state=JSON.parse(JSON.stringify(seed));
  state.nodes ||= []; state.relationships ||= []; state.roots ||= [];
  const node=id=>state.nodes.find(n=>n.id===id);
  function cleanDataSchema(){
    state.nodes.forEach(n=>{delete n.birth;});
  }
  cleanDataSchema();
  // Permanent sibling birth order. Older saved data is migrated once using
  // the existing relationship order so the current tree does not jump.
  function normalizeBirthOrders(){
    const parentGroups=new Map();
    state.relationships.filter(r=>r.type==='parent-child'&&r.parent&&r.child).forEach(r=>{
      if(!parentGroups.has(r.parent))parentGroups.set(r.parent,[]);
      parentGroups.get(r.parent).push(r.child);
    });
    parentGroups.forEach((ids)=>{
      const used=new Set(); let next=1;
      // Single pass: a valid order is kept only the first time it's seen.
      // A later sibling claiming the same number (e.g. from a hand-edited
      // or merged backup) is treated as unset and given the next free slot,
      // instead of silently keeping a duplicate.
      ids.forEach(id=>{
        const n=node(id); if(!n)return;
        const v=Number(n.birthOrder);
        if(Number.isInteger(v)&&v>0&&!used.has(v)){
          used.add(v);
        }else{
          while(used.has(next))next++;
          n.birthOrder=next++; used.add(n.birthOrder);
        }
      });
    });
  }
  normalizeBirthOrders();
  let selected=null, scale=1, tx=40, ty=30, dragging=false, sx=0,sy=0,stx=0,sty=0, focusId=null, editingPhoto='', searchQuery='';
  // On phones, every transient UI layer gets a browser-history entry so the
  // device Back gesture behaves like Esc instead of leaving the website.
  let mobileResetPending=false, mobileResetTarget=null;
  const $=id=>document.getElementById(id), viewport=$('viewport'), canvas=$('canvas'), tree=$('tree'), links=$('links'), side=$('side'), sideContent=$('sideContent')||side;
  const rels=(id,type)=>state.relationships.filter(r=>r.type===type && (r.parent===id||r.child===id||r.person1===id||r.person2===id));
  const children=id=>state.relationships.filter(r=>r.type==='parent-child'&&r.parent===id).map(r=>r.child).filter(Boolean);
  const orderedChildren=id=>children(id).sort((a,b)=>{
    const ao=Number(node(a)?.birthOrder), bo=Number(node(b)?.birthOrder);
    const av=Number.isInteger(ao)&&ao>0?ao:999999;
    const bv=Number.isInteger(bo)&&bo>0?bo:999999;
    return av-bv || children(id).indexOf(a)-children(id).indexOf(b);
  });
  const ordinal=n=>{const v=Number(n);if(!Number.isInteger(v)||v<1)return '';const mod100=v%100;const suffix=(mod100>=11&&mod100<=13)?'th':({1:'st',2:'nd',3:'rd'}[v%10]||'th');return `${v}${suffix}`};
  const parents=id=>state.relationships.filter(r=>r.type==='parent-child'&&r.child===id).map(r=>r.parent).filter(Boolean);
  const spouseIds=id=>{const n=node(id); if(!n)return []; if(n.husband&&n.wife)return []; return state.relationships.filter(r=>r.type==='spouse'&&(r.person1===id||r.person2===id)).map(r=>r.person1===id?r.person2:r.person1).filter(Boolean)};
  const displayName=n=>{if(n?.husband||n?.wife){return [n.husband,n.wife].filter(Boolean).join(' - ')}return String(n?.name||'')};
  const birthDateDisplay=n=>{const v=n?.birthDate||'';if(/^\d{4}-\d{2}-\d{2}$/.test(v)){const d=new Date(v+'T00:00:00');return d.toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}return v};
  const birthYearDisplay=n=>{const v=n?.birthDate||'';if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v.slice(0,4);return v};
  const parsePair=n=>{if(typeof n==='object'&&n){if(n.husband||n.wife)return [n.husband,n.wife].filter(Boolean); n=displayName(n)}let p=String(n||'').split(/\s+-\s*/).map(x=>x.trim()).filter(Boolean);return p.length>1?p.slice(0,2):p};
  const initials=s=>String(s||'').replace(/\(.*?\)/g,'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?';
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  function depthMap(){const depth=new Map();const q=[];const roots=state.roots.filter(node);const fallback=state.nodes.filter(n=>!parents(n.id));(roots.length?roots:fallback).forEach(r=>{depth.set(r.id||r,0);q.push(r.id||r)});let guard=0;const guardLimit=(state.nodes.length+1)*8;while(q.length){if(++guard>guardLimit)break;const id=q.shift();for(const c of children(id)){const d=(depth.get(id)||0)+1;if(!depth.has(c)||d<depth.get(c)){depth.set(c,d);q.push(c)}}}state.nodes.forEach(n=>{if(!depth.has(n.id))depth.set(n.id,0)});return depth}
  function branchSet(id){const out=new Set([id]);const q=[id];while(q.length){for(const c of children(q.shift()))if(!out.has(c)){out.add(c);q.push(c)}}return out}
  function ancestorSet(id){const out=new Set([id]);const q=[id];while(q.length){for(const p of parents(q.shift()))if(!out.has(p)){out.add(p);q.push(p)}}return out}
  function branchLabel(id){const d=depthMap().get(id)||0;return d===0?'Founding generation':`Generation ${d+1}`}
  function generationColor(depth){return Math.min(5,Math.max(1,(depth||0)+1))}
  function lineage(id){const chain=[];let cur=id;const seen=new Set();while(cur&&!seen.has(cur)){seen.add(cur);chain.unshift(cur);cur=parents(cur)[0]}return chain}
  function familyStats(){const depth=depthMap();const generations=Math.max(0,...depth.values())+1;const spouses=state.nodes.filter(n=>n.husband&&n.wife).length;const linksCount=state.relationships.length;const withPhotos=state.nodes.filter(n=>n.photo).length;const dated=state.nodes.filter(n=>n.birthDate).length;const counts={};depth.forEach(d=>counts[d]=(counts[d]||0)+1);return {generations,spouses,linksCount,withPhotos,dated,counts}}
  function render(){
    tree.innerHTML='';links.innerHTML='';const depth=depthMap();const by=new Map();state.nodes.forEach(n=>{const d=depth.get(n.id)||0;if(!by.has(d))by.set(d,[]);by.get(d).push(n)});
    // Organic / wave layout: keep the original V4 card design and ordering,
    // but give each generation a gentle flowing wave. Horizontal spacing is
    // collision-free, while small vertical offsets create the natural,
    // hand-drawn SmartArt feel the family tree had originally.
    const gapX=72,gapY=112,w=202,h=92,marginX=70,marginY=45;
    const waveAmplitude=26;
    const waveStep=Math.PI/2.35;

    // True branch-aligned tree layout.
    // A branch receives enough horizontal space for all of its descendants.
    // Siblings are packed together underneath their own parent, and the
    // parent's center is the midpoint of that complete sibling group.
    // The original organic wave is retained as a subtle vertical offset.
    const byId=new Map(state.nodes.map(n=>[n.id,n]));
    const childMap=new Map();
    state.nodes.forEach(n=>{
      const ordered=[...new Set(children(n.id).filter(id=>byId.has(id)))];
      ordered.sort((a,b)=>{
        const ao=Number(byId.get(a)?.birthOrder), bo=Number(byId.get(b)?.birthOrder);
        const av=Number.isInteger(ao)&&ao>0?ao:999999;
        const bv=Number.isInteger(bo)&&bo>0?bo:999999;
        return av-bv;
      });
      childMap.set(n.id,ordered);
    });

    const rootIds=[];
    const rootSet=new Set();
    state.roots.filter(id=>byId.has(id)).forEach(id=>{rootIds.push(id);rootSet.add(id)});
    state.nodes.forEach(n=>{
      if(!parents(n.id).length&&!rootSet.has(n.id)){
        rootIds.push(n.id);rootSet.add(n.id);
      }
    });

    // Standard tidy-tree slot calculation. A leaf occupies one slot.
    const slotWidth=w+gapX;
    const slots=new Map();
    const visiting=new Set();

    function calcSlots(id){
      if(slots.has(id))return slots.get(id);
      if(visiting.has(id))return 1;
      visiting.add(id);
      const cs=childMap.get(id)||[];
      const count=cs.length?cs.reduce((sum,c)=>sum+calcSlots(c),0):1;
      visiting.delete(id);
      slots.set(id,count);
      return count;
    }
    rootIds.forEach(calcSlots);

    function branchWidth(id){
      const count=slots.get(id)||1;
      return Math.max(w,count*slotWidth-gapX);
    }

    // First assign each root a contiguous region.
    const rootGap=Math.max(140,gapX*1.8);
    let cursor=marginX;

    // Guards against a corrupted/imported relationship cycle (e.g. a node
    // whose parent chain loops back to one of its own descendants), which
    // would otherwise recurse forever and crash the tab.
    const placed=new Set();
    function place(id,left,depth,branchIndex=0){
      const n=byId.get(id);
      if(!n||placed.has(id))return;
      placed.add(id);

      const bw=branchWidth(id);
      const center=left+bw/2;
      n._x=center-w/2;

      // Keep the V6/V9 wave feeling without moving a card into another
      // branch's horizontal slot.
      const phase=branchIndex*waveStep+(depth%2?Math.PI/4:0);
      n._y=marginY+depth*(h+gapY+22)+Math.sin(phase)*waveAmplitude;

      const cs=childMap.get(id)||[];
      if(!cs.length)return;

      const widths=cs.map(branchWidth);
      const total=widths.reduce((a,b)=>a+b,0)+(cs.length-1)*gapX;
      let childLeft=left+(bw-total)/2;

      cs.forEach((cid,i)=>{
        place(cid,childLeft,depth+1,i);
        childLeft+=widths[i]+gapX;
      });
    }

    rootIds.forEach((rid,i)=>{
      const rw=branchWidth(rid);
      place(rid,cursor,0,i);
      cursor+=rw+rootGap;
    });

    const maxX=Math.max(1600,cursor+marginX);
    const maxY=Math.max(...state.nodes.map(n=>n._y||0),500)+h+marginY+120;
    tree.style.width=maxX+'px';tree.style.height=maxY+'px';
    links.setAttribute('width',maxX);links.setAttribute('height',maxY);
    links.setAttribute('viewBox',`0 0 ${maxX} ${maxY}`);
    // When a branch is focused, highlight both the selected member's
    // descendants and the complete ancestral path leading back to the root.
    // This makes the exact lineage visually traceable through both cards and
    // connecting lines.
    const active=focusId?new Set([...branchSet(focusId),...ancestorSet(focusId)]):null;
    state.nodes.forEach(n=>{const el=document.createElement('div');const dim=active&&!active.has(n.id);const branchActive=active&&active.has(n.id);const isMatch=searchQuery&&displayName(n).toLowerCase().includes(searchQuery);el.className='person'+(selected===n.id?' selected':'')+(dim?' dim':'')+(branchActive?' branch-active':'')+(n.photo?' has-photo':'')+(isMatch?' match':'');el.dataset.id=n.id;el.dataset.gen=generationColor(depth.get(n.id)||0);el.style.left=n._x+'px';el.style.top=n._y+'px';const pair=parsePair(n);const photo=n.photo?`<img src="${n.photo}" alt="">`:initials(displayName(n));const relationship=n.note?.trim()||'';const generation=branchLabel(n.id);el.innerHTML=`<div class="generation"></div><div class="avatar">${photo}</div><div class="tag">${pair.length>1?'Family pair':'Family member'}</div><div class="name">${pair.map(esc).join(' <span style="opacity:.42">·</span> ')}</div><div class="meta"><span class="relationship">${esc(relationship)}</span><span class="generation-label">${esc(generation)}</span></div>`;el.onclick=e=>{e.stopPropagation();if(panMoved){panMoved=false;return}select(n.id)};el.ondblclick=e=>{e.stopPropagation();if(panMoved){panMoved=false;return}focusOn(n.id)};tree.appendChild(el)});
    const visible=id=>true;
    const addPath=(a,b,klass='')=>{
      if(!a||!b||!visible(a.id)||!visible(b.id))return;
      const x1=a._x+w/2,y1=a._y+h,x2=b._x+w/2,y2=b._y;
      const mid=y1+(y2-y1)/2;
      const bend=Math.max(28,Math.min(80,Math.abs(x2-x1)*0.22));
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',`M ${x1} ${y1} C ${x1} ${y1+bend}, ${x1} ${mid}, ${x1+(x2-x1)*0.5} ${mid} S ${x2} ${mid+bend}, ${x2} ${y2}`);
      if(klass)p.classList.add(klass);links.appendChild(p);
    };

    state.relationships.forEach(r=>{
      if(r.type==='parent-child'){
        const a=node(r.parent),b=node(r.child);
        const activePath=active&&a&&b&&active.has(a.id)&&active.has(b.id);
        addPath(a,b,activePath?'branch-active':'');
      }else if(r.type==='spouse'){
        const a=node(r.person1),b=node(r.person2);
        if(!a||!b||!visible(a.id)||!visible(b.id))return;
        const p=document.createElementNS('http://www.w3.org/2000/svg','path');
        const y=a._y+h/2,x1=a._x+w,x2=b._x;
        p.setAttribute('d',`M ${x1} ${y} C ${x1+35} ${y}, ${x2-35} ${b._y+h/2}, ${x2} ${b._y+h/2}`);
        p.classList.add('spouse');
        if(active&&active.has(a.id)&&active.has(b.id))p.classList.add('branch-active');
        links.appendChild(p);
      }
    });
    updateTransform();
  }
  function isPhone(){return innerWidth<=600}
  function mobileLayers(state=history.state){return Array.isArray(state?.familyRootLayers)?state.familyRootLayers.slice():[]}
  function mobileDepth(state=history.state){const d=Number(state?.familyRootDepth);return Number.isInteger(d)&&d>=0?d:0}
  function pushMobileLayer(layerName,extra={}){
    if(!isPhone())return;
    const layers=mobileLayers();
    if(layers[layers.length-1]===layerName)return;
    history.pushState({
      familyRootLayer:true,
      familyRootDepth:mobileDepth()+1,
      familyRootLayers:[...layers,layerName],
      familyRootFocusId:extra.focusId ?? history.state?.familyRootFocusId ?? null,
      ...extra
    },'',location.href);
  }
  function replaceMobileState(layers,extra={}){
    if(!isPhone())return;
    const current=history.state||{};
    history.replaceState({
      familyRootLayer:true,
      familyRootDepth:mobileDepth(current),
      familyRootLayers:layers.slice(),
      familyRootFocusId:extra.focusId ?? current.familyRootFocusId ?? null,
      ...extra
    },'',location.href);
  }
  function backMobileLayer(target='normal'){
    if(!isPhone())return false;
    const layers=mobileLayers();
    if(!layers.length)return false;
    if(target!=='normal' && layers[layers.length-1]!==target)return false;
    history.back();return true;
  }
  function hideAllMobileLayers(){
    side.classList.remove('open');$('sideBackdrop')?.classList.add('hidden');
    $('modal')?.classList.add('hidden');$('timeline')?.classList.add('hidden');
    $('insights')?.classList.add('hidden');$('info')?.classList.add('hidden');
    const box=$('photoLightbox');if(box){box.classList.add('hidden');box.setAttribute('aria-hidden','true')}
    if($('fullPhoto'))$('fullPhoto').src='';
  }
  function applyMobileHistoryState(state){
    if(!isPhone())return;
    const layers=mobileLayers(state);
    const hasFocus=layers.includes('focus'),hasSide=layers.includes('side');
    const hasModal=layers.includes('modal'),hasTimeline=layers.includes('timeline');
    const hasInsights=layers.includes('insights'),hasInfo=layers.includes('info');
    const hasPhoto=layers.includes('photo');
    focusId=hasFocus?(state?.familyRootFocusId||focusId):null;
    hideAllMobileLayers();
    render();
    if(hasSide && selected){
      side.classList.add('open');$('sideBackdrop')?.classList.remove('hidden');showDetails(selected);
    }
    if(hasModal)$('modal')?.classList.remove('hidden');
    if(hasTimeline)$('timeline')?.classList.remove('hidden');
    if(hasInsights)$('insights')?.classList.remove('hidden');
    if(hasInfo)$('info')?.classList.remove('hidden');
    if(hasPhoto){
      const box=$('photoLightbox');
      if(box){box.classList.remove('hidden');box.setAttribute('aria-hidden','false')}
      if($('fullPhoto'))$('fullPhoto').src=state?.familyRootPhotoSrc||'';
    }
    if(!hasSide&&!hasFocus&&!hasModal&&!hasTimeline&&!hasInsights&&!hasInfo&&!hasPhoto){
      focusId=null;selected=null;
      if($('search')){$('search').value='';searchQuery='';}
      render();
    }
  }
  function initializeMobileHistory(){
    if(!isPhone())return;
    history.replaceState({familyRootBase:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null},'',location.href);
    history.pushState({familyRootGuard:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null},'',location.href);
  }
  function finishMobileReset(targetId){
    mobileResetPending=false;mobileResetTarget=null;
    focusId=null;selected=null;searchQuery='';
    if($('search'))$('search').value='';
    hideAllMobileLayers();render();mobileStartView(targetId);
  }
  function select(id,{skipHistory=false}={}){
    selected=id;render();showDetails(id);
    if(isPhone()){
      if(!skipHistory&&!side.classList.contains('open'))pushMobileLayer('side',{focusId:focusId||null});
      side.classList.add('open');$('sideBackdrop')?.classList.remove('hidden');
    }
  }
  function focusOn(id){
    const target=node(id);if(!target)return;
    focusId=id;select(id);
    if(isPhone()){
      const layers=mobileLayers();
      if(layers.includes('focus')&&layers.includes('side')){
        replaceMobileState(layers,{focusId:id});
      }else if(layers.includes('side')){
        // The existing side-panel history entry becomes the focus-only state;
        // then one fresh entry represents focus + panel. Back therefore closes
        // the panel first, keeps the snake, and the next Back clears the snake.
        const depth=mobileDepth();
        history.replaceState({familyRootLayer:true,familyRootDepth:depth,familyRootLayers:['focus'],familyRootFocusId:id},'',location.href);
        history.pushState({familyRootLayer:true,familyRootDepth:depth+1,familyRootLayers:['focus','side'],familyRootFocusId:id},'',location.href);
      }else{
        const depth=mobileDepth();
        history.pushState({familyRootLayer:true,familyRootDepth:depth+1,familyRootLayers:['focus'],familyRootFocusId:id},'',location.href);
        history.pushState({familyRootLayer:true,familyRootDepth:depth+2,familyRootLayers:['focus','side'],familyRootFocusId:id},'',location.href);
      }
    }
    clearTimeout(centerTimer);
    centerTimer=setTimeout(()=>{
      const n=node(id);if(!n)return;
      const r=viewport.getBoundingClientRect();
      const targetX=(n._x+101)*scale,targetY=(n._y+46)*scale;
      tx=r.width/2-targetX;ty=r.height/2-targetY;updateTransform();centerTimer=null;
    },30);
  }
  function clearFocus(){focusId=null;selected=null;render();showEmpty(true)}
  function openPhotoLightbox(src,name){
    if(!src)return;
    if(isPhone())pushMobileLayer('photo');
    const box=$('photoLightbox'),img=$('fullPhoto');img.src=src;img.alt=`${name||'Profile'} full size photo`;
    box.classList.remove('hidden');box.setAttribute('aria-hidden','false');
    setTimeout(()=>$('closePhotoLightbox')?.focus(),0);
  }
  function closePhotoLightbox(skipHistory=false){
    if(!skipHistory&&backMobileLayer('photo'))return;
    const box=$('photoLightbox');if(!box)return;
    box.classList.add('hidden');box.setAttribute('aria-hidden','true');$('fullPhoto').src='';
  }
  function showDetails(id){const n=node(id);if(!n)return;const ps=parents(id),cs=children(id),ss=spouseIds(id);const allRelated=[...new Set([...ps,...cs,...ss])];const img=n.photo?`<img src="${n.photo}" alt="">`:initials(displayName(n));const pair=parsePair(n);const coupleDetails=(n.husband||n.wife)?`<div class="detail-section"><h3>Family pair</h3><div class="mini-list">${n.husband?`<div class="mini" style="cursor:default">Husband · ${esc(n.husband)}</div>`:''}${n.wife?`<div class="mini" style="cursor:default">Wife · ${esc(n.wife)}</div>`:''}</div></div>`:'';const isCouple=!!(n.husband||n.wife);const personalDetails=(n.birthDate||n.husbandBirthDate||n.wifeBirthDate||n.birthPlace||n.death||n.note)?`<div class="detail-section"><h3>Personal details</h3><div class="mini-list">${isCouple&&n.husbandBirthDate?`<div class="mini" style="cursor:default">Husband born · ${esc(birthDateDisplay({birthDate:n.husbandBirthDate}))}</div>`:''}${isCouple&&n.wifeBirthDate?`<div class="mini" style="cursor:default">Wife born · ${esc(birthDateDisplay({birthDate:n.wifeBirthDate}))}</div>`:''}${isCouple&&n.husbandBirthPlace?`<div class="mini" style="cursor:default">Husband birth place · ${esc(n.husbandBirthPlace)}</div>`:''}${isCouple&&n.wifeBirthPlace?`<div class="mini" style="cursor:default">Wife birth place · ${esc(n.wifeBirthPlace)}</div>`:''}${!isCouple&&birthDateDisplay(n)?`<div class="mini" style="cursor:default">Born · ${esc(birthDateDisplay(n))}</div>`:''}${!isCouple&&n.birthPlace?`<div class="mini" style="cursor:default">Birth place · ${esc(n.birthPlace)}</div>`:''}${n.death?`<div class="mini" style="cursor:default">Died · ${esc(n.death)}</div>`:''}${n.note?`<div class="mini" style="cursor:default">Note · ${esc(n.note)}</div>`:''}</div></div>`:'';sideContent.innerHTML=`<div class="profile-head"><div class="profile-avatar${n.photo?' photo-clickable':''}" ${n.photo?'title="Click to view photo" role="button" tabindex="0"':''}>${img}</div><div><h2>${esc(displayName(n))}</h2><div class="muted">${ps.length?'Family member':'Top-level family member'}</div><span class="branch-pill">${esc(branchLabel(id))}</span></div></div><div class="stats-grid"><div class="stat"><b>${cs.length}</b><span>Children</span></div><div class="stat"><b>${allRelated.length}</b><span>Direct connections</span></div></div>${coupleDetails}${personalDetails}${ps.length?`<div class="detail-section"><h3>Parents</h3><div class="mini-list">${ps.map(x=>`<div class="mini" data-jump="${x}">${esc(displayName(node(x)))}</div>`).join('')}</div></div>`:''}${ss.length?`<div class="detail-section"><h3>Legacy spouse connection</h3><div class="mini-list">${ss.map(x=>`<div class="mini" data-jump="${x}">${esc(displayName(node(x)))}</div>`).join('')}</div></div>`:''}${cs.length?`<div class="detail-section"><h3>Children · ${cs.length}</h3><div class="mini-list">${orderedChildren(id).map(x=>{const child=node(x);const order=child?.birthOrder;return `<div class="mini" data-jump="${x}">${order?`<span style="opacity:.65;min-width:70px;display:inline-block">${esc(ordinal(order))} child</span>`:''}${esc(displayName(child))}</div>`}).join('')}</div></div>`:''}<div class="side-actions"><button id="focusSelected">◎ Focus branch</button><button id="editSelected">Edit</button><button id="deleteSelected" class="danger">Delete family node</button></div>`;sideContent.querySelectorAll('[data-jump]').forEach(e=>e.onclick=()=>select(e.dataset.jump));$('focusSelected').onclick=()=>focusOn(id);$('editSelected').onclick=()=>openModal(n);$('deleteSelected').onclick=()=>removeNode(id);
    const profilePhoto=sideContent.querySelector('.photo-clickable');
    if(profilePhoto){
      const openPhoto=()=>openPhotoLightbox(n.photo,displayName(n));
      profilePhoto.onclick=openPhoto;
      profilePhoto.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPhoto()}};
    }
  }
  function showEmpty(){sideContent.innerHTML='<div class="side-empty"><div class="empty-icon">⌘</div><h2>Select a member</h2><p>Choose any card to explore their family connections, branch and personal details.</p></div>';closeSidePanel(true)}
  function closeSidePanel(fromPopstate=false){
    if(!fromPopstate && backMobileLayer('side'))return;
    side.classList.remove('open');
    $('sideBackdrop')?.classList.add('hidden');
  }
  window.addEventListener('popstate',()=>{
    if(!isPhone())return;
    const state=history.state||{};
    if(state.familyRootBase){
      applyMobileHistoryState({familyRootBase:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null});
      history.pushState({familyRootGuard:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null},'',location.href);
      if(mobileResetPending)finishMobileReset(mobileResetTarget);
      return;
    }
    if(state.familyRootGuard||state.familyRootLayer){
      applyMobileHistoryState(state);
      if(mobileResetPending && state.familyRootGuard)finishMobileReset(mobileResetTarget);
      return;
    }
    applyMobileHistoryState({familyRootGuard:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null});
    history.pushState({familyRootGuard:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null},'',location.href);
  });
  initializeMobileHistory();
  $('sideClose')&&($('sideClose').onclick=()=>closeSidePanel());
  $('sideBackdrop')&&($('sideBackdrop').onclick=()=>closeSidePanel());
  function updateTransform(){canvas.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;$('zoomValue').textContent=Math.round(scale*100)+'%'}
  function fit(){const r=viewport.getBoundingClientRect(),cw=parseFloat(tree.style.width)||1200,ch=parseFloat(tree.style.height)||800;scale=Math.min(.92,r.width/cw,r.height/ch);scale=Math.max(.24,scale);tx=(r.width-cw*scale)/2;ty=(r.height-ch*scale)/2;updateTransform()}
  // Reset always returns to this exact founding/root family node.
  // Do not derive the reset target from the last search/selection or from a
  // child ordering; the user-visible reset point is fixed by this family.
  const RESET_TARGET_NAME='Late Kaalu baa - Late Basanti';
  function resetTargetId(){
    const exact=state.nodes.find(n=>displayName(n)===RESET_TARGET_NAME || n.name===RESET_TARGET_NAME);
    if(exact)return exact.id;
    const candidateRoots=(state.roots||[]).map(id=>node(id)).filter(Boolean);
    const rootWithChildren=candidateRoots.find(root=>
      state.relationships.some(r=>r.type==='parent-child' && r.parent===root.id && node(r.child))
    );
    const root=rootWithChildren||candidateRoots[0]||null;
    return root?.id || state.nodes[0]?.id || null;
  }
  function mobileStartView(targetOverride=null){
    const r=viewport.getBoundingClientRect();
    const targetId=targetOverride&&node(targetOverride)?targetOverride:resetTargetId();
    const target=targetId?node(targetId):null;
    if(!target){fit();return}
    const width=r.width||innerWidth;
    // A readable phone scale is intentionally different from "Fit tree":
    // fitting all 59+ nodes makes every card tiny. The user can still use
    // Fit tree when they actually want the entire structure on screen.
    scale=width<=420?.78:width<=600?.82:.86;
    scale=Math.min(1,Math.max(.62,scale));
    const targetX=(target._x+101)*scale;
    const targetY=(target._y+46)*scale;
    tx=r.width/2-targetX;
    ty=Math.max(18,42-targetY);
    updateTransform();
  }
  function zoom(f,cx=viewport.clientWidth/2,cy=viewport.clientHeight/2){const old=scale;scale=Math.min(3.5,Math.max(.15,scale*f));tx=cx-(cx-tx)*(scale/old);ty=cy-(cy-ty)*(scale/old);updateTransform()}
  let panMoved=false,panPointerId=null;
  // Two-finger pinch-to-zoom. The desktop wheel handler below has no touch
  // equivalent, so without this, phones/tablets could only zoom via the
  // tiny +/- buttons.
  const touchPoints=new Map();
  let pinchStartDist=0, pinchStartScale=1;
  const pointDist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const pointMid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  viewport.addEventListener('wheel',e=>{
    e.preventDefault();
    const r=viewport.getBoundingClientRect();
    // Use the real cursor position inside the viewport, not e.offsetX/e.offsetY.
    // This keeps the exact point under the cursor fixed while zooming.
    const cx=e.clientX-r.left,cy=e.clientY-r.top;
    const factor=Math.exp(-e.deltaY*0.0018);
    zoom(factor,cx,cy);
  },{passive:false});
  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('button') || (e.pointerType==='mouse' && e.button===2))return;
    if(e.pointerType==='touch'){
      touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(touchPoints.size===2){
        // Second finger landed: stop any single-finger pan and start pinching.
        dragging=false;panMoved=true;
        const [a,b]=[...touchPoints.values()];
        pinchStartDist=pointDist(a,b)||1;
        pinchStartScale=scale;
        return;
      }
      if(touchPoints.size>2)return;
    }
    dragging=true;panMoved=false;panPointerId=e.pointerId;
    viewport.classList.add('dragging');
    sx=e.clientX;sy=e.clientY;stx=tx;sty=ty;
  });
  viewport.addEventListener('pointermove',e=>{
    if(touchPoints.has(e.pointerId))touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touchPoints.size===2){
      const [a,b]=[...touchPoints.values()];
      const dist=pointDist(a,b)||1;
      const mid=pointMid(a,b);
      const r=viewport.getBoundingClientRect();
      const old=scale;
      scale=Math.min(3.5,Math.max(.15,pinchStartScale*(dist/pinchStartDist)));
      const cx=mid.x-r.left,cy=mid.y-r.top;
      tx=cx-(cx-tx)*(scale/old);ty=cy-(cy-ty)*(scale/old);
      updateTransform();
      return;
    }
    if(!dragging || e.pointerId!==panPointerId)return;
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.abs(dx)>4 || Math.abs(dy)>4)panMoved=true;
    if(panMoved){tx=stx+dx;ty=sty+dy;updateTransform()}
  });
  function endPan(e){
    touchPoints.delete(e.pointerId);
    if(touchPoints.size<2)pinchStartDist=0;
    if(!dragging || (e.pointerId!=null && e.pointerId!==panPointerId))return;
    dragging=false;panPointerId=null;viewport.classList.remove('dragging');
    if(panMoved){
      // A real drag should not trigger the click that follows pointerup.
      // Keep this flag until the browser finishes dispatching that click.
      setTimeout(()=>{panMoved=false},50);
    } else {
      panMoved=false;
    }
  }
  viewport.addEventListener('pointerup',endPan);
  viewport.addEventListener('pointercancel',endPan);
  viewport.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{
    const openOverlay=[$('modal'),$('timeline'),$('insights'),$('info')].find(el=>el&&!el.classList.contains('hidden'));
    if(e.key==='Tab' && openOverlay){
      const items=[...openOverlay.querySelectorAll(modalFocusable)].filter(el=>el.offsetParent!==null);
      if(items.length){
        const first=items[0],last=items[items.length-1];
        if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
        else if(!openOverlay.contains(document.activeElement)){e.preventDefault();first.focus();}
      }
      return;
    }
    if(e.key!=='Escape')return;
    e.preventDefault();
    // Esc and the phone Back gesture share the same navigation model. Keep the
    // existing special case where Esc closes a full-screen photo first.
    const photoLightbox=$('photoLightbox');
    if(photoLightbox && !photoLightbox.classList.contains('hidden')){closePhotoLightbox();return;}
    if(isPhone()){
      const depth=mobileDepth();
      if(depth>0)history.go(-depth)
      else applyMobileHistoryState({familyRootGuard:true,familyRootDepth:0,familyRootLayers:[],familyRootFocusId:null});
      return;
    }
    const modal=$('modal'), timeline=$('timeline'), insights=$('insights'), info=$('info');
    modal?.classList.add('hidden');timeline?.classList.add('hidden');insights?.classList.add('hidden');info?.classList.add('hidden');
    if(selected||focusId)clearFocus(true);else showEmpty();
    if($('search')){$('search').value='';searchQuery='';render()}
  });
  $('closePhotoLightbox').onclick=closePhotoLightbox;
  $('photoLightbox').onclick=e=>{if(e.target===$('photoLightbox'))closePhotoLightbox()};

  $('zoomIn').onclick=()=>zoom(1.15);$('zoomOut').onclick=()=>zoom(.87);$('resetBtn').onclick=()=>{
    clearTimeout(searchTimer);searchTimer=null;clearTimeout(centerTimer);centerTimer=null;
    const targetId=resetTargetId();focusId=null;selected=null;searchQuery='';
    if($('search'))$('search').value='';
    if(isPhone()){
      hideAllMobileLayers();render();
      const depth=mobileDepth();
      if(depth>0){mobileResetPending=true;mobileResetTarget=targetId;history.go(-depth)}
      else finishMobileReset(targetId);
      return;
    }
    const r=viewport.getBoundingClientRect(),target=targetId?node(targetId):null;scale=1;
    if(target){tx=r.width/2-(target._x+101);ty=Math.max(30,r.height*0.2-(target._y+46))}else{tx=40;ty=30}
    updateTransform();render();showEmpty();
  };
  $('focusBtn').onclick=()=>selected?focusOn(selected):alert('Select a family member first.');
  $('themeBtn').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('family-theme',document.body.classList.contains('dark')?'dark':'light');$('themeBtn').textContent=document.body.classList.contains('dark')?'☀':'☾'};if(localStorage.getItem('family-theme')==='dark')$('themeBtn').click();
  let centerTimer=null;
  function centerOn(id){
    clearTimeout(centerTimer);
    centerTimer=setTimeout(()=>{
      centerTimer=null;
      const n=node(id);if(!n)return;
      const r=viewport.getBoundingClientRect();
      const targetX=(n._x+101)*scale,targetY=(n._y+46)*scale;
      tx=r.width/2-targetX;ty=r.height/2-targetY;
      updateTransform();
    },30);
  }
  let searchTimer=null;
  $('search').addEventListener('input',e=>{
    const val=e.target.value;
    clearTimeout(searchTimer);
    // Debounced: typing quickly no longer re-renders the whole tree on every keystroke.
    searchTimer=setTimeout(()=>{
      searchQuery=val.trim().toLowerCase();
      if(searchQuery){const n=state.nodes.find(x=>displayName(x).toLowerCase().includes(searchQuery));if(n){select(n.id);centerOn(n.id);return}}
      render();
    },150);
  });
  function fillParentOptions(exclude,sel){
    // Block the node itself AND all of its own descendants from being offered
    // as its parent — picking a descendant as a parent creates a relationship
    // loop that crashes the tree layout and corrupts the saved file.
    const blocked=exclude?branchSet(exclude):new Set();
    $('parentSelect').innerHTML='<option value="">No parent (top-level)</option>'+state.nodes.filter(x=>!blocked.has(x.id)).map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(displayName(x))}</option>`).join('')
  }
  let formType='single';
  function setMemberType(type){
    const married=type==='married';
    if(married && formType!=='married'){
      // Preserve an existing single person's details when converting the form to a couple.
      // The existing person becomes the husband by default; the new spouse starts blank.
      if(!$('husbandName').value.trim()) $('husbandName').value=$('personName').value.trim();
      if(!$('husbandBirthDate').value) $('husbandBirthDate').value=$('birthDate').value;
      if(!$('husbandBirthPlace').value.trim()) $('husbandBirthPlace').value=$('birthPlace').value.trim();
    }else if(!married && formType==='married'){
      // If a couple is switched back to single, keep the first person's (husband's)
      // details in the single-person fields rather than losing them.
      if(!$('personName').value.trim()) $('personName').value=$('husbandName').value.trim();
      if(!$('birthDate').value) $('birthDate').value=$('husbandBirthDate').value;
      if(!$('birthPlace').value.trim()) $('birthPlace').value=$('husbandBirthPlace').value.trim();
    }
    formType=married?'married':'single';
    $('singleTypeBtn').classList.toggle('active',!married);$('marriedTypeBtn').classList.toggle('active',married);$('singleFields').classList.toggle('hidden',married);$('coupleFields').classList.toggle('hidden',!married);$('singleBirthFields').classList.toggle('hidden',married);$('coupleBirthFields').classList.toggle('hidden',!married);$('personName').required=!married;$('husbandName').required=married;$('wifeName').required=married;$('personName').disabled=married;$('husbandName').disabled=!married;$('wifeName').disabled=!married;$('birthDate').disabled=married;$('birthPlace').disabled=married;$('husbandBirthDate').disabled=!married;$('wifeBirthDate').disabled=!married;$('husbandBirthPlace').disabled=!married;$('wifeBirthPlace').disabled=!married
  }
  const modalFocusable='button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function openModal(n=null){
    pushMobileLayer('modal');
    editingPhoto=n?.photo||''; formType='single';
    $('modal').classList.remove('hidden');$('modalKicker').textContent=n?'EDIT MEMBER':'NEW MEMBER';$('modalTitle').textContent=n?'Edit family member':'Add family member';$('personId').value=n?.id||'';
    const isCouple=!!(n?.husband||n?.wife);
    $('personName').value=isCouple?'':(n?.name||'');$('husbandName').value=n?.husband||'';$('wifeName').value=n?.wife||'';$('personNote').value=n?.note||'';
    $('birthDate').value=/^\d{4}-\d{2}-\d{2}$/.test(n?.birthDate||'')?n.birthDate:'';$('husbandBirthDate').value=/^\d{4}-\d{2}-\d{2}$/.test(n?.husbandBirthDate||'')?n.husbandBirthDate:'';$('wifeBirthDate').value=/^\d{4}-\d{2}-\d{2}$/.test(n?.wifeBirthDate||'')?n.wifeBirthDate:'';
    $('birthPlace').value=n?.birthPlace||'';$('husbandBirthPlace').value=n?.husbandBirthPlace||'';$('wifeBirthPlace').value=n?.wifeBirthPlace||'';$('deathYear').value=n?.death||'';$('birthOrder').value=(Number.isInteger(Number(n?.birthOrder))&&Number(n?.birthOrder)>0)?n.birthOrder:'';$('photoPreview').innerHTML=n?.photo?`<img src="${n.photo}" alt="">`:'+';$('personPhoto').value='';fillParentOptions(n?.id,n?.id?parents(n.id)[0]:'');setMemberType(isCouple?'married':'single');setTimeout(()=>{const first=$('modal').querySelector(modalFocusable+':not([disabled])');first?.focus()},0)
  }
  function closeModal(skipHistory=false){
    if(!skipHistory && backMobileLayer('modal'))return;
    $('modal').classList.add('hidden');$('addBtn')?.focus();
  }$('addBtn').onclick=()=>openModal();$('singleTypeBtn').onclick=()=>setMemberType('single');$('marriedTypeBtn').onclick=()=>setMemberType('married');$('closeModal').onclick=()=>closeModal();$('cancelModal').onclick=()=>closeModal();$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};
  $('personPhoto').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{
      // Downscale + re-encode before storing. Uncompressed phone photos
      // (often 3-5MB each) would otherwise bloat family-data.js and slow
      // down every future load, especially on mobile.
      const img=new Image();
      img.onload=()=>{
        const maxDim=480;
        const ratio=Math.min(1,maxDim/Math.max(img.width,img.height));
        const cw=Math.max(1,Math.round(img.width*ratio)),ch=Math.max(1,Math.round(img.height*ratio));
        const c=document.createElement('canvas');c.width=cw;c.height=ch;
        const ctx=c.getContext('2d');
        if(!ctx){editingPhoto=reader.result;$('photoPreview').innerHTML=`<img src="${editingPhoto}" alt="">`;return}
        ctx.drawImage(img,0,0,cw,ch);
        editingPhoto=c.toDataURL('image/jpeg',.82);
        $('photoPreview').innerHTML=`<img src="${editingPhoto}" alt="">`;
      };
      img.onerror=()=>{
        // Not a decodable image (or an SVG/HEIC the canvas can't touch) —
        // fall back to storing the original rather than losing the photo.
        editingPhoto=reader.result;
        $('photoPreview').innerHTML=`<img src="${editingPhoto}" alt="">`;
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(f);
  };
  $('personForm').onsubmit=e=>{
    e.preventDefault();
    const id=$('personId').value||'p-'+Date.now();
    const married=!$('coupleFields').classList.contains('hidden');
    const husband=$('husbandName').value.trim(),wife=$('wifeName').value.trim(),singleName=$('personName').value.trim();
    const name=married?[husband,wife].filter(Boolean).join(' - '):singleName;
    const existing=node(id);
    const birthDate=married?'':$('birthDate').value;
    const husbandBirthDate=married?$('husbandBirthDate').value:'';
    const wifeBirthDate=married?$('wifeBirthDate').value:'';
    const husbandBirthPlace=married?$('husbandBirthPlace').value.trim():'';
    const wifeBirthPlace=married?$('wifeBirthPlace').value.trim():'';
    const birthPlace=married?'':$('birthPlace').value.trim();
    const parentId=$('parentSelect').value;
    const rawOrder=$('birthOrder').value.trim();
    const parsedOrder=parseInt(rawOrder,10);
    const birthOrder=(rawOrder&&Number.isInteger(parsedOrder))?Math.max(1,parsedOrder):null;
    const obj={id,name,husband:married?husband:'',wife:married?wife:'',note:$('personNote').value.trim(),birthDate,husbandBirthDate,wifeBirthDate,husbandBirthPlace,wifeBirthPlace,birthPlace,death:$('deathYear').value.trim(),photo:editingPhoto||'',birthOrder};
    if(!name)return;
    if(married&&(!husband||!wife)){alert('Please enter both husband and wife names.');return}
    // If this member belongs to a sibling group, insert at the requested
    // birth order and shift later siblings down. Editing an existing member
    // therefore never lets another card steal its position.
    const oldParent=existing?parents(id)[0]:'';
    const oldOrder=existing?Number(existing.birthOrder):null;
    if(parentId && birthOrder){
      const siblings=state.relationships.filter(r=>r.type==='parent-child'&&r.parent===parentId&&r.child!==id).map(r=>node(r.child)).filter(Boolean);
      if(oldParent===parentId && oldOrder===birthOrder){
        // keep the existing order exactly as entered
      }else{
        siblings.sort((a,b)=>(Number(a.birthOrder)||999999)-(Number(b.birthOrder)||999999));
        siblings.forEach(sib=>{const o=Number(sib.birthOrder);if(Number.isInteger(o)&&o>=birthOrder)sib.birthOrder=o+1;});
      }
    }
    if(existing)Object.assign(existing,obj);else state.nodes.push(obj);
    state.relationships=state.relationships.filter(r=>!(r.type==='parent-child'&&r.child===id));
    if(parentId)state.relationships.push({type:'parent-child',parent:parentId,child:id});
    if(!existing&&!parentId)state.roots.push(id);
    normalizeBirthOrders();
    save();
    selected=id;
    const currentLayers=mobileLayers();
    if(isPhone()&&currentLayers.includes('modal')){
      const desired=currentLayers.filter(x=>x!=='modal');if(!desired.includes('side'))desired.push('side');
      replaceMobileState(desired,{focusId:focusId||null});
    }
    closeModal(true);render();showDetails(id);side.classList.add('open');$('sideBackdrop')?.classList.remove('hidden')
  };
  function removeNode(id){const n=node(id);if(!n||!confirm(`Delete “${n.name}” and its family connections?`))return;state.nodes=state.nodes.filter(x=>x.id!==id);state.relationships=state.relationships.filter(r=>r.parent!==id&&r.child!==id&&r.person1!==id&&r.person2!==id);state.roots=state.roots.filter(x=>x!==id);selected=null;focusId=null;save();render();showEmpty()}
  const save=()=>{
    // Browser storage keeps the current browser session safe. The permanent
    // project copy is created with Backup -> family-data.js.
    localStorage.setItem(KEY,JSON.stringify(state));
  };
  function serializeProjectData(){
    return 'window.FAMILY_SEED = '+JSON.stringify(state,null,2)+';\n';
  }
  function downloadProjectData(){
    const blob=new Blob([serializeProjectData()],{type:'text/javascript;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='family-data.js';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }
  $('exportBtn').onclick=downloadProjectData;

  function showTimeline(){pushMobileLayer('timeline');const items=state.nodes.filter(n=>n.birthDate).sort((a,b)=>Number(birthYearDisplay(a))-Number(birthYearDisplay(b)));$('timelineBody').innerHTML=items.length?items.map(n=>`<div class="timeline-item"><div class="timeline-year">${esc(birthYearDisplay(n))}</div><div class="timeline-node"><b>${esc(displayName(n))}</b><span>${esc(n.note||branchLabel(n.id))}${n.death?' · '+esc(n.death):''}</span></div></div>`).join(''):'<div class="side-empty"><h2>No birth years yet</h2><p>Edit members to add birth years and build a richer family timeline.</p></div>';$('timeline').classList.remove('hidden')}
  $('timelineBtn').onclick=showTimeline;$('closeTimeline').onclick=()=>closeTimeline();$('timeline').onclick=e=>{if(e.target===$('timeline'))closeTimeline()};
  function showInsights(){pushMobileLayer('insights');const x=familyStats();const max=Math.max(...Object.values(x.counts),1);const genBars=Object.entries(x.counts).sort((a,b)=>a[0]-b[0]).map(([d,c])=>`<div class="bar-row"><span>Generation ${Number(d)+1}</span><div class="bar"><i style="width:${Math.round(c/max*100)}%"></i></div><b>${c}</b></div>`).join('');$('insightsBody').innerHTML=`<div class="insight"><div class="big">${state.nodes.length}</div><div class="label">Family members</div></div><div class="insight"><div class="big">${x.generations}</div><div class="label">Generations</div></div><div class="insight"><div class="big">${x.spouses}</div><div class="label">Partner connections</div></div><div class="insight"><div class="big">${x.withPhotos}</div><div class="label">Profiles with photos</div></div><div class="insight wide"><b>Generation spread</b>${genBars}</div><div class="insight wide"><b>Tree coverage</b><div class="lineage" style="margin-top:10px"><span>${x.dated} with birth year</span><b>·</b><span>${x.linksCount} connections</span><b>·</b><span>${state.nodes.length-x.dated} without birth year</span></div></div>`;$('insights').classList.remove('hidden')}
  function closeTimeline(skipHistory=false){if(!skipHistory && backMobileLayer('timeline'))return;$('timeline').classList.add('hidden')}
  function closeInsights(skipHistory=false){if(!skipHistory && backMobileLayer('insights'))return;$('insights').classList.add('hidden')}
  function showMyFamily(){focusId=null;if(isPhone()&&mobileLayers().includes('focus'))replaceMobileState(mobileLayers().filter(x=>x!=='focus'),{focusId:null});if(!selected){const first=state.nodes.find(n=>parents(n.id))||state.nodes[0];if(first)select(first.id)}else{render();showDetails(selected)}}
  $('statsBtn').onclick=showInsights;$('closeInsights').onclick=()=>closeInsights();$('insights').onclick=e=>{if(e.target===$('insights'))closeInsights()};
  function showInfo(){pushMobileLayer('info');$('info').classList.remove('hidden');setTimeout(()=>{$('closeInfo')?.focus()},0)}
  function closeInfo(skipHistory=false){if(!skipHistory && backMobileLayer('info'))return;$('info').classList.add('hidden')}
  $('infoBtn').onclick=showInfo;$('closeInfo').onclick=()=>closeInfo();$('info').onclick=e=>{if(e.target===$('info'))closeInfo()};$('meBtn').onclick=showMyFamily;
  render();setTimeout(()=>{if(innerWidth<=600)mobileStartView();else fit()},80);
})();
