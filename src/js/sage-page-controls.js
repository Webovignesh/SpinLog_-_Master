// Real page fields, owned by SpinLog. Sage gets labels and legal choices,
// never arbitrary selectors, credential access, or a pretend save result.
(function (root) {
  'use strict';
  const customMenus = {
    serviceType:'serviceTypeMenu',
    serviceHistoryTypeFilter:'serviceHistoryTypeMenu',
    docsHistoryTypeFilter:'docsHistoryTypeMenu',
  };
  const ids = [
    ...Object.keys(customMenus),
    'serviceHistorySearch','serviceHistoryFromDate','serviceHistoryToDate','serviceHistoryPerPage',
    'docsHistorySearch','docsHistoryFromDate','docsHistoryToDate','docsHistoryPerPage',
    'serviceEditType','serviceEditDate','serviceEditDue','serviceEditOdo','serviceEditCost','serviceEditNotes',
    'docAddName','docAddNotes','historicNotesInput','historicNotesDate','historicNotesTime',
    'coverEditInput','parkFieldLabel','parkFieldLevel','parkFieldUntil','parkFieldNotes','dkSearchInput',
  ];
  const $ = id => document.getElementById(id);
  const modalClosers = {serviceEditModal:'serviceEditClose',docAddModal:'docAddClose',coverEditModal:'coverEditClose',historicNotesModal:'historicNotesCancel',parkHistoryModal:'parkHistoryClose',sageSettingsModal:null};
  const ownedDialogs = new Set([...Object.keys(modalClosers),'docsPlayer']);
  const handles = new WeakMap(), targets = new Map(); let nextHandle = 0;
  function scope() {
    const modal = activeModal();
    return modal ? ownedDialogs.has(modal.id) ? modal : null : document.querySelector('main section.active');
  }
  function sensitive(el) {
    return ['password','file'].includes(el.type) || /(?:password|apikey|keyinput|vaultpass|keyring|vault|credential)/i.test(el.id || '')
      || !!el.closest('#sageVoiceOverlay,#sageKeyRing,#sageVaultPanel');
  }
  function handle(el) {
    if (!handles.has(el)) handles.set(el,`control-${++nextHandle}`);
    const id = handles.get(el); targets.set(id,el); return id;
  }
  const normalize = value => String(value).trim().toLowerCase().replace(/\s+/g,' ');
  const aliases = {odo:['odometer','odo','odo (km)'],cost:['cost','amount'],date:['date','service date'],nextDue:['next due','next due date'],notes:['notes']};
  const named = (el,id,text) => [label(el,id),...(aliases[el.name] || [])].some(name => normalize(name) === normalize(text));
  const calendarField = el => el.type === 'date' && el.dataset.dkCal === 'true';
  const editable = el => !el.disabled && (!el.readOnly || calendarField(el));
  function activeModal() {
    const dialogs = [...document.querySelectorAll('.sl-modal-overlay,.sl-slide-overlay,[role="dialog"][aria-modal="true"]')]
      .filter(el => !el.closest('#sageVoiceOverlay')).map(el => el.closest('[aria-hidden]') || el);
    return [...new Set([...Object.keys(modalClosers).map($),...dialogs])].filter(el => el && !el.closest('[hidden],[aria-hidden="true"]')
      && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .sort((a,b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0)).at(-1);
  }
  function fields() {
    const map = new Map(ids.map(id => [id,$(id)]).filter(([,el]) => el));
    for (const name of ['date','nextDue','odo','cost','notes']) {
      const el = document.querySelector(`#serviceEntryForm [name="${name}"]`);
      if (el) map.set(`serviceEntryForm.${name}`,el);
    }
    for (const el of scope()?.querySelectorAll?.('input,textarea,select') || []) {
      if (sensitive(el) || el.type === 'hidden' || el.closest('#sageChatInput')) continue;
      if (![...map.values()].includes(el)) map.set(el.id || handle(el),el);
    }
    return map;
  }
  function surface(el) {
    // Hidden inputs backing the app's custom dropdown are editable only
    // through their visible, owned wrapper and its existing option handler.
    return customMenus[el.id] ? el.closest('.custom-entry-select,.custom-history-select')
      : calendarField(el) ? el.closest('.date-shell') || el.parentElement : el;
  }
  function visible(el) {
    const node = surface(el);
    if (!node || node.closest('[hidden],[aria-hidden="true"]') || !node.getClientRects().length || getComputedStyle(node).visibility === 'hidden') return false;
    const filters = node.closest('.history-tools');
    if (filters && !filters.classList.contains('is-open')) return false;
    const modal = activeModal();
    return !modal || modal.contains(node);
  }
  function choices(el) {
    if (customMenus[el.id]) return [...($(customMenus[el.id])?.querySelectorAll('[role="option"][data-value]') || [])]
      .filter(option=>!option.disabled && option.getAttribute('aria-disabled')!=='true')
      .map(option => ({value:option.dataset.value,label:option.textContent.trim(),option}));
    if (el.tagName === 'SELECT') return [...el.options].filter(option => !option.disabled)
      .map(option => ({value:option.value,label:option.textContent.trim(),option}));
    return null;
  }
  function label(el, id) {
    const explicit = el.getAttribute('aria-label');
    if (explicit) return explicit;
    const text = el.labels?.[0]?.querySelector('span')?.textContent || el.labels?.[0]?.textContent;
    return (text || el.placeholder || id).trim().replace(/\s+/g,' ').slice(0,120);
  }
  function descriptor(id,el) {
    const options = choices(el);
    return {field:id,label:label(el,id),type:options ? 'dropdown' : el.type || 'text',value:el.value,
      form:el.closest('form,[role="dialog"]')?.id || document.querySelector('main section.active')?.id,
      required:!!el.required,editable:editable(el),
      ...(['checkbox','radio'].includes(el.type) ? {checked:!!el.checked} : {}),
      ...(options ? {options:options.map(({value,label}) => ({value,label}))} : {}),
      ...(el.min ? {min:el.min} : {}),...(el.max ? {max:el.max} : {}),
      ...(el.maxLength > 0 ? {maxLength:el.maxLength} : {})};
  }
  function inspect() {
    return {ok:true,section:document.querySelector('main section.active')?.id || null,
      dialog:activeModal()?.id || null,
      fields:[...fields()].filter(([,el]) => visible(el)).map(([id,el]) => descriptor(id,el)),
      actions:availableActions(),
      controls:controls(),scrollTargets:scrollTargets(),scrollDirections:['up','down','left','right','top','bottom'],
      note:'These are the live visible controls. Record forms are drafts until saved through the existing data tools or form; settings and filter handlers may apply immediately. Files must be chosen by the user. Never claim a draft was saved.'};
  }
  function controls() {
    for (const [id,el] of targets) if (!el.isConnected) targets.delete(id);
    const list = [];
    for (const el of scope()?.querySelectorAll?.('button,a[href],[role="button"],input[type="checkbox"],input[type="radio"],input[type="range"]') || []) {
      if (sensitive(el) || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.tagName === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#') && !el.matches('.doc-open-pill')) continue;
      // Pickers and app confirmations keep their real gesture. Data tools own
      // confirmed deletes and report actual persistence, rather than a click.
      if ((!el.matches('[data-media-open],.doc-open-pill') && /confirm|hold|file|upload|key|vault|(?:pick|import)$/i.test(el.id || '')) || el.closest('[data-confirmation]')) continue;
      const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g,' ').slice(0,120);
      if (text) list.push({control:handle(el),label:text,type:el.type || el.getAttribute('role') || 'button',
        ...(el.type === 'range' ? {field:el.id || handle(el),value:el.value,min:el.min,max:el.max,step:el.step} : {})});
    }
    return list;
  }
  function painted() {
    return new Promise(resolve=>{
      const timer=root.setTimeout(resolve,180);
      root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>{root.clearTimeout(timer);resolve();}));
    });
  }
  async function click({control} = {}, {isCancelled = () => false} = {}) {
    if(isCancelled())return {ok:false,error:'This action was cancelled.'};
    const listed = controls().find(c => c.control === control), el = targets.get(control);
    if (!listed || !el?.isConnected || !visible(el) || el.disabled) return {ok:false,error:'That control is unavailable. Inspect the current page again.'};
    const form = el.closest('form');
    if (el.type === 'submit' && form?.checkValidity && !form.checkValidity()) return {ok:false,error:'Complete the required form fields first.'};
    root.SageVoice?.minimize?.();
    // File buttons must await the actual viewer, not merely dispatch a click
    // that starts signing a URL in an unobserved event handler.
    const mediaId=el.getAttribute('data-media-open');
    const documentId=el.matches('.doc-open-pill') ? el.closest('.doc-card[data-type]')?.dataset.type : null;
    if(mediaId || documentId) {
      const result=await root.dkApp?.openStoredFile({kind:mediaId?'media':'document',id:mediaId || documentId,action:'open',isCancelled});
      return result?.ok && !isCancelled() ? {...result,activated:listed.label,verified:true,outcome:'file_opened'}
        : result?.ok ? {ok:false,error:'Opening was cancelled.'} : result || {ok:false,error:'The file viewer is unavailable.'};
    }
    const playerAction={docsPlayerNext:'next',docsPlayerPrev:'previous',docsPlayerClose:'close'}[el.id];
    if(playerAction) {
      const result=await root.dkApp?.controlMediaPlayer({action:playerAction,isCancelled});
      return result?.ok && !isCancelled() ? {...result,activated:listed.label,verified:true,outcome:'player_control'}
        : result?.ok ? {ok:false,error:'Playback command was cancelled.'} : result || {ok:false,error:'The file viewer is unavailable.'};
    }
    el.click();
    await painted();
    if(isCancelled())return {ok:false,error:'This action was cancelled. The button may already have been pressed.'};
    return {ok:true,activated:listed.label,verified:true,outcome:'button_pressed',submitted:el.type === 'submit',saved:false,
      note:'The existing control was activated. This alone does not confirm a saved record, upload or deletion.',page:inspect()};
  }
  function scrollable(node, horizontal = false) {
    if(!node || !visible(node))return false;
    const css=getComputedStyle(node),overflow=horizontal ? css.overflowX : css.overflowY;
    return /(auto|scroll)/.test(overflow) && (horizontal ? node.scrollWidth-node.clientWidth : node.scrollHeight-node.clientHeight)>1;
  }
  function scrollTargets() {
    const owner=scope();if(!owner)return [];
    return [owner,...owner.querySelectorAll('*')].filter(node=>!sensitive(node) && (scrollable(node) || scrollable(node,true)))
      .slice(0,20).map(node=>({control:handle(node),label:node.getAttribute('aria-label') || node.id || 'Scrollable panel',
        top:Math.round(node.scrollTop),left:Math.round(node.scrollLeft),vertical:node.scrollHeight-node.clientHeight>1,horizontal:node.scrollWidth-node.clientWidth>1}));
  }
  function scrollNode(control,horizontal) {
    const owner=scope();if(!owner)return null;
    if(control) {
      if(![...controls(),...scrollTargets()].some(c=>c.control===control))return null;
      let node=targets.get(control);
      while(node && node!==document.scrollingElement) {
        if(scrollable(node,horizontal))return node;
        if(node===owner && activeModal())return null;
        node=node.parentElement;
      }
      return activeModal() ? null : document.scrollingElement;
    }
    if(activeModal()) {
      // Dialog content often scrolls inside its overlay. Never fall through to
      // the page behind an open dialog when that content has reached its edge.
      const candidates=[owner,...owner.querySelectorAll('*')].filter(node=>scrollable(node,horizontal));
      return candidates.find(node=>node.contains(document.activeElement)) || candidates.sort((a,b)=>
        (horizontal ? b.scrollWidth-b.clientWidth-(a.scrollWidth-a.clientWidth) : b.scrollHeight-b.clientHeight-(a.scrollHeight-a.clientHeight)))[0] || null;
    }
    let node=owner;
    while(node && node!==document.scrollingElement){if(scrollable(node,horizontal))return node;node=node.parentElement;}
    return document.scrollingElement;
  }
  let scrolling=Promise.resolve();
  async function stopScroll(node,owner) {
    if(scope()!==owner)return;
    const position={top:node.scrollTop,left:node.scrollLeft,behavior:'instant'};
    node.scrollTo(position);
    // A compositor frame may already be queued when a smooth scroll is
    // interrupted. Hold the captured position once that frame has painted.
    await painted();
    if(scope()===owner)node.scrollTo(position);
    await painted();
  }
  function scroll(args = {}, context = {}) {
    const owner=scope();
    const task=()=>performScroll(args,context,owner);
    const result=scrolling.then(task,task);
    scrolling=result.catch(()=>{});
    return result;
  }
  async function performScroll({direction,target:control,count=1,amount='page'} = {}, {isCancelled=()=>false} = {}, owner) {
    if (!['up','down','left','right','top','bottom'].includes(direction)) return {ok:false,error:'Choose up, down, left, right, top or bottom.'};
    if(!Number.isInteger(count) || count<1 || count>8 || !['small','page','large'].includes(amount))return {ok:false,error:'Use 1 to 8 scroll steps and small, page or large.'};
    if (!owner || scope()!==owner) return {ok:false,error:'The page or dialog changed. Inspect it before scrolling.'};
    if(isCancelled())return {ok:false,error:'Scrolling was cancelled.'};
    const horizontal=['left','right'].includes(direction),node=scrollNode(control,horizontal);
    if (!node?.scrollTo) return {ok:false,error:'This page cannot scroll.'};
    const before={top:node.scrollTop,left:node.scrollLeft};let steps=0,boundary=null;
    root.SageVoice?.minimize?.();
    for(let iteration=0;iteration<count;iteration++) {
      if(isCancelled() || scope()!==owner)return {ok:false,error:'Scrolling was cancelled or the page changed.',steps};
      const top=node.scrollTop,left=node.scrollLeft;
      const maxTop=Math.max(0,node.scrollHeight-node.clientHeight),maxLeft=Math.max(0,node.scrollWidth-node.clientWidth);
      const step=Math.max(80,(horizontal ? node.clientWidth || root.innerWidth : node.clientHeight || root.innerHeight)*({small:.3,page:.7,large:1.4}[amount]));
      const nextTop=Math.max(0,Math.min(maxTop,direction==='top'?0:direction==='bottom'?maxTop:top+(direction==='down'?step:direction==='up'?-step:0)));
      const nextLeft=Math.max(0,Math.min(maxLeft,left+(direction==='right'?step:direction==='left'?-step:0)));
      if(Math.abs(nextTop-top)<2 && Math.abs(nextLeft-left)<2){boundary=['up','top','left'].includes(direction)?horizontal?'left':'top':horizontal?'right':'bottom';break;}
      node.scrollTo({top:nextTop,left:nextLeft,behavior:root.dkReduceMotion?.()?'instant':'smooth'});
      // scrollTo may return nothing, and scrollend is not universal. Poll the
      // real coordinates so a second step starts after this one actually ends.
      const deadline=Date.now()+1600;let finished=false;
      while(Date.now()<deadline) {
        if(isCancelled() || scope()!==owner) {
          await stopScroll(node,owner);
          return {ok:false,error:'Scrolling was cancelled or the page changed.',steps};
        }
        if(Math.abs(node.scrollTop-nextTop)<1 && Math.abs(node.scrollLeft-nextLeft)<1){finished=true;break;}
        await new Promise(resolve=>root.setTimeout(resolve,25));
      }
      if(!finished) {
        await stopScroll(node,owner);
        return {ok:false,error:'The requested scroll did not finish. It may have been blocked or interrupted.',steps,
          position:{top:Math.round(node.scrollTop),left:Math.round(node.scrollLeft)}};
      }
      steps++;
      if(['top','bottom'].includes(direction))break;
    }
    const after={top:node.scrollTop,left:node.scrollLeft};
    return {ok:true,verified:true,direction,steps,moved:Math.abs(after.top-before.top)>1 || Math.abs(after.left-before.left)>1,boundary,
      position:{top:Math.round(after.top),left:Math.round(after.left)},surface:activeModal()?.id || 'page'};
  }
  async function highlight(el, isCancelled = () => false) {
    if (!el || !visible(el) || isCancelled()) return {ok:false,error:'The record is not visible.'};
    root.SageVoice?.minimize?.();
    await painted();
    if (!el.isConnected || !visible(el) || isCancelled()) return {ok:false,error:'Showing the record was cancelled or the page changed.'};
    document.querySelectorAll('.sage-focus-target').forEach(node=>node.classList.remove('sage-focus-target'));
    el.classList.add('sage-focus-target');
    el.scrollIntoView({behavior:root.dkReduceMotion?.()?'auto':'smooth',block:'center'});
    return {ok:true,highlighted:true};
  }
  function actionTarget(action) {
    const section = document.querySelector('main section.active')?.id;
    const prefix = {service:'serviceHistory',docs:'docsHistory'}[section];
    const suffix = {show_filters:'FilterToggle',hide_filters:'FilterToggle',clear_filters:'ClearFilters',next_results:'Next',previous_results:'Prev'}[action];
    if (prefix && suffix) return $(prefix+suffix);
    if (action === 'close_search') return $('dkSearchInput');
    return null;
  }
  function availableActions() {
    const actions = ['show_filters','hide_filters','clear_filters','next_results','previous_results','close_search']
      .filter(action => { const el = actionTarget(action); return el && visible(el) && !el.disabled; });
    const modal = activeModal();
    if (modal && (modal.id === 'sageSettingsModal' || $(modalClosers[modal.id]))) actions.push('close_form');
    if (!modal) actions.push('open_search');
    return actions;
  }
  function validate(el,value) {
    if (typeof value !== 'string' || value.length > 2000) throw new Error('Use a string of at most 2000 characters.');
    if (['checkbox','radio'].includes(el.type)) {
      if (!['true','false'].includes(value)) throw new Error('Use true or false for this switch.');
      return {value:el.value,checked:value==='true'};
    }
    const options = choices(el);
    if (options) {
      const exact = options.find(option => option.value === value);
      const matches = exact ? [exact] : options.filter(option => normalize(option.label) === normalize(value) || normalize(option.value) === normalize(value));
      if (matches.length !== 1) throw new Error(`Choose one of: ${options.map(o => o.label).join(', ')}.`);
      return {value:matches[0].value,option:matches[0].option};
    }
    if (el.maxLength > 0 && value.length > el.maxLength) throw new Error(`Maximum ${el.maxLength} characters.`);
    // Let the browser validate date/number syntax without changing the real
    // field. No partial draft is left behind when another value is invalid.
    const probe = el.cloneNode(false); probe.required = false; probe.readOnly = false; probe.value = value;
    if (probe.value !== value && value !== '') throw new Error(`Invalid ${el.type || 'text'} value.`);
    if (value && probe.checkValidity && !probe.checkValidity()) throw new Error(`Invalid ${el.type || 'text'} value; check its range and format.`);
    return {value};
  }
  function fill({fields:changes} = {}, {isCancelled=()=>false} = {}) {
    if(isCancelled())return {ok:false,error:'Filling was cancelled.',changed:[],saved:false};
    if (!Array.isArray(changes) || !changes.length || changes.length > 20) return {ok:false,error:'Provide 1 to 20 fields from inspect_page_controls.'};
    const map = fields(), seen = new Set(), prepared = [];
    try {
      for (const change of changes) {
        const el = map.get(change.field);
        if (!el || !visible(el)) throw new Error(`${change.field}: open its page/form first and inspect the controls.`);
        if (!editable(el) || seen.has(change.field)) throw new Error(`${change.field}: unavailable or repeated field.`);
        seen.add(change.field);
        prepared.push({id:change.field,el,...validate(el,change.value)});
      }
    } catch (err) { return {ok:false,error:err.message,changed:[],saved:false}; }
    const changed = [];
    for (const item of prepared) {
      // A preceding dropdown change may hide or disable a dependent field
      // (Mods/Updates hides Next Due). Do not write into that hidden control.
      if (isCancelled() || !visible(item.el) || !editable(item.el)) {
        return {ok:false,error:`${item.id} became unavailable after an earlier change.`,changed,saved:false};
      }
      if (item.checked !== undefined) { if (item.el.checked !== item.checked) item.el.click(); }
      else if (customMenus[item.el.id]) item.option.click();
      else {
        item.el.value = item.value;
        item.el.dispatchEvent(new Event('input',{bubbles:true}));
        item.el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if (item.el.value !== item.value || item.checked !== undefined && item.el.checked !== item.checked) return {ok:false,error:`${item.id} did not accept the value.`,changed,saved:false};
      changed.push(descriptor(item.id,item.el));
    }
    root.SageVoice?.minimize?.();
    return {ok:true,verified:true,changed,saved:false,note:'The existing input/change handlers ran. Settings, switches and filters may apply immediately. Record forms remain drafts; no record was submitted.'};
  }
  async function openForm({form} = {}, {isCancelled=()=>false} = {}) {
    if(isCancelled())return {ok:false,error:'Opening was cancelled.'};
    const section = {service_entry:'service',document_upload:'docs'}[form];
    if (!section) return {ok:false,error:'Choose service_entry or document_upload. For existing records use the read/update tools.'};
    if (activeModal()) return {ok:false,error:'Close the current form or dialog before opening another.'};
    const result = await root.dkApp?.goToSection({section,isCancelled});
    if (!result?.ok) return result || {ok:false,error:'The app is still starting.'};
    if(isCancelled())return {ok:false,error:'Opening was cancelled.'};
    root.SageVoice?.minimize?.();
    if (form === 'document_upload') $('docAddTile')?.click();
    await painted();
    const target = $(form === 'service_entry' ? 'serviceEntryForm' : 'docAddName');
    if (!target?.getClientRects().length || target.closest('[aria-hidden="true"],[hidden]')) return {ok:false,error:'The requested form could not open.'};
    target.scrollIntoView({behavior:'smooth',block:'center'});
    return {...inspect(),verified:true,opened:form,saved:false};
  }
  async function action({action} = {}, {isCancelled=()=>false} = {}) {
    if(isCancelled())return {ok:false,error:'This action was cancelled.'};
    if (action === 'close_form') {
      const modal = activeModal();
      if (!modal) return {ok:false,error:'There is no open form or settings panel.'};
      if (modal.id === 'sageSettingsModal') root.SageUI?.close?.();
      else {
        const close = $(modalClosers[modal.id]);
        if (!close || close.disabled) return {ok:false,error:'That form cannot close yet.'};
        close.click();
      }
      if (modal.getAttribute('aria-hidden') !== 'true') return {ok:false,error:'The form did not close.'};
      return {...inspect(),verified:true,activated:action,saved:false};
    }
    const section = document.querySelector('main section.active')?.id;
    const prefix = {service:'serviceHistory',docs:'docsHistory'}[section];
    const suffix = {show_filters:'FilterToggle',hide_filters:'FilterToggle',clear_filters:'ClearFilters',next_results:'Next',previous_results:'Prev'}[action];
    let target;
    if (prefix && suffix) target = $(prefix+suffix);
    else if (action === 'open_search') {
      if (activeModal()) return {ok:false,error:'Close the current form or dialog before opening search.'};
      const section = $('dkSearchInput')?.closest('main section')?.id;
      if (!section) return {ok:false,error:'Search is unavailable.'};
      const opened = await root.dkApp?.goToSection({section,isCancelled});
      if (!opened?.ok) return opened || {ok:false,error:'Search could not open.'};
      target = $('dkSearchInput');
    } else if (action === 'close_search') target = $('dkSearchInput');
    if(isCancelled() || !target || !visible(target) || target.disabled) return {ok:false,error:'That control is unavailable on the current page.'};
    const pageBefore=suffix && /^(Next|Prev)$/.test(suffix) ? $(prefix+'Pages')?.querySelector('[aria-current="page"]')?.textContent : null;
    if (action === 'open_search') { target.focus(); target.dispatchEvent(new Event('input',{bubbles:true})); }
    else if (action === 'close_search') target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else if (!suffix?.endsWith('Toggle') || target.getAttribute('aria-expanded') !== String(action === 'show_filters')) target.click();
    await painted();
    if(isCancelled())return {ok:false,error:'This action was cancelled.'};
    if(pageBefore && $(prefix+'Pages')?.querySelector('[aria-current="page"]')?.textContent===pageBefore)return {ok:false,error:'The results page did not change.'};
    if (suffix?.endsWith('Toggle') && target.getAttribute('aria-expanded') !== String(action === 'show_filters')) return {ok:false,error:'The filter panel did not change.'};
    root.SageVoice?.minimize?.();
    return {...inspect(),verified:true,activated:action,saved:false};
  }
  // Unambiguous simple UI requests skip a model round-trip. Values still use
  // the same live field validation/handlers; ambiguous speech goes to SageAI.
  function commandText(raw) {
    return String(raw || '').trim().replace(/[.!?]+$/,'').replace(/^(?:i (?:want|need)(?: you)? to|i(?:'d| would) like (?:you )?to)\s+/i,'').replace(/^(?:sage[, ]+)?(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?/i,'');
  }
  function canHandle(raw) {
    const text = commandText(raw);
    if (intent(raw)) return true;
    const select = text.match(/^(?:select|choose)\s+(.+)$/i);
    if (select) return [...fields()].some(([,el]) => (choices(el) || []).some(choice => normalize(choice.label) === normalize(select[1]) || normalize(choice.value) === normalize(select[1])));
    const set = text.match(/^(?:set|fill|enter|change|slide|move|type)\s+(?:the )?(.+?)\s+(?:to|with|as)\s+(.+)$/i);
    if (!set) return false;
    return [...fields()].some(([id,el]) => named(el,id,set[1]));
  }
  function intent(raw) {
    const text = commandText(raw);
    const movement = text.match(/^scroll (?:the )?(?:page |site )?(up|down|left|right|(?:to (?:the )?)?top|(?:to (?:the )?)?bottom)(?:\s+(again|more|a little|a bit|a lot|twice|(?:[1-8]|one|two|three|four|five|six|seven|eight) times?))?$/i);
    if (movement) return {name:'scroll_page',direction:movement[1].replace(/^to (?:the )?/i,'').toLowerCase(),
      ...(/twice|times?/i.test(movement[2] || '') ? {count:({twice:2,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8}[movement[2].toLowerCase().split(' ')[0]] || Number(movement[2][0]))} : {}),
      ...(/a little|a bit|a lot/i.test(movement[2] || '') ? {amount:movement[2].toLowerCase()==='a lot'?'large':'small'} : {})};
    const press = text.match(/^(?:click|press|tap) (?:the )?(.+?)(?: button)?$/i);
    if (press) { const matches=controls().filter(c=>normalize(c.label)===normalize(press[1]) || normalize(c.label).replace(/^(?:open|view)\s+/,'')===normalize(press[1]));if(matches.length===1)return {name:'click_page_control',control:matches[0].control}; }
    const form = text.match(/^open (?:the )?(service (?:entry )?form|(?:add )?document (?:upload )?form)$/i);
    if (form) return {name:'open_page_form',form:/^service/i.test(form[1]) ? 'service_entry' : 'document_upload'};
    const action = {'show filters':'show_filters','hide filters':'hide_filters','clear filters':'clear_filters','next results':'next_results','previous results':'previous_results','open search':'open_search','close search':'close_search','close form':'close_form','close the form':'close_form','close settings':'close_form'}[text.toLowerCase()];
    if (action) return {name:'activate_page_control',action};
    const select = text.match(/^(?:select|choose)\s+(.+)$/i);
    if (select) {
      const matches = [];
      for (const [id,el] of fields()) if (visible(el) && editable(el)) {
        for (const choice of choices(el) || []) if (normalize(choice.label) === normalize(select[1]) || normalize(choice.value) === normalize(select[1])) matches.push({field:id,value:choice.value});
      }
      if (matches.length === 1) return {name:'fill_page_fields',fields:matches};
    }
    const set = text.match(/^(?:set|fill|enter|change|slide|move|type)\s+(?:the )?(.+?)\s+(?:to|with|as)\s+(.+)$/i);
    if (!set) return null;
    const matches = [...fields()].filter(([id,el]) => visible(el) && editable(el) && named(el,id,set[1]));
    if (matches.length !== 1) return null;
    const [id,el] = matches[0];
    const value = set[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/,(_,double,single) => double ?? single);
    try { return {name:'fill_page_fields',fields:[{field:id,value:['checkbox','radio'].includes(el.type) ? value : validate(el,value).value}]}; } catch { return null; }
  }
  root.SagePageControls = {inspect,fill,openForm,action,intent,canHandle,click,scroll,highlight};
})(typeof self !== 'undefined' ? self : this);
