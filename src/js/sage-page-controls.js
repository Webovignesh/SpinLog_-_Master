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
  const modalClosers = {serviceEditModal:'serviceEditClose',docAddModal:'docAddClose',coverEditModal:'coverEditClose',historicNotesModal:'historicNotesSkip',parkHistoryModal:'parkHistoryClose',sageSettingsModal:null};
  const normalize = value => String(value).trim().toLowerCase().replace(/\s+/g,' ');
  const calendarField = el => el.type === 'date' && el.dataset.dkCal === 'true';
  const editable = el => !el.disabled && (!el.readOnly || calendarField(el));
  function activeModal() {
    return Object.keys(modalClosers).map($).filter(el => el && !el.hidden && el.getAttribute('aria-hidden') === 'false'
      && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .sort((a,b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0)).at(-1);
  }
  function fields() {
    const map = new Map(ids.map(id => [id,$(id)]).filter(([,el]) => el));
    for (const name of ['date','nextDue','odo','cost','notes']) {
      const el = document.querySelector(`#serviceEntryForm [name="${name}"]`);
      if (el) map.set(`serviceEntryForm.${name}`,el);
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
    if (!node || node.closest('[hidden],[aria-hidden="true"]') || !node.getClientRects().length) return false;
    const filters = node.closest('.history-tools');
    if (filters && !filters.classList.contains('is-open')) return false;
    const modal = activeModal();
    return !modal || modal.contains(node);
  }
  function choices(el) {
    if (customMenus[el.id]) return [...($(customMenus[el.id])?.querySelectorAll('[role="option"][data-value]') || [])]
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
      ...(options ? {options:options.map(({value,label}) => ({value,label}))} : {}),
      ...(el.min ? {min:el.min} : {}),...(el.max ? {max:el.max} : {}),
      ...(el.maxLength > 0 ? {maxLength:el.maxLength} : {})};
  }
  function inspect() {
    return {ok:true,section:document.querySelector('main section.active')?.id || null,
      fields:[...fields()].filter(([,el]) => visible(el)).map(([id,el]) => descriptor(id,el)),
      note:'These are the live visible controls. Form fields are drafts until saved through the existing data tools or form. Files must be chosen by the user. Never claim a draft was saved.'};
  }
  function validate(el,value) {
    if (typeof value !== 'string' || value.length > 2000) throw new Error('Use a string of at most 2000 characters.');
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
  function fill({fields:changes} = {}) {
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
      if (!visible(item.el) || !editable(item.el)) {
        return {ok:false,error:`${item.id} became unavailable after an earlier change.`,changed,saved:false};
      }
      if (customMenus[item.el.id]) item.option.click();
      else {
        item.el.value = item.value;
        item.el.dispatchEvent(new Event('input',{bubbles:true}));
        item.el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if (item.el.value !== item.value) return {ok:false,error:`${item.id} did not accept the value.`,changed,saved:false};
      changed.push(descriptor(item.id,item.el));
    }
    root.SageVoice?.minimize?.();
    return {ok:true,changed,saved:false,note:'The visible fields/dropdowns changed. Form details are filled for review, not submitted or saved.'};
  }
  async function openForm({form} = {}) {
    const section = {service_entry:'service',document_upload:'docs'}[form];
    if (!section) return {ok:false,error:'Choose service_entry or document_upload. For existing records use the read/update tools.'};
    const result = await root.dkApp?.goToSection({section});
    if (!result?.ok) return result || {ok:false,error:'The app is still starting.'};
    root.SageVoice?.minimize?.();
    if (form === 'document_upload') $('docAddTile')?.click();
    const target = $(form === 'service_entry' ? 'serviceEntryForm' : 'docAddName');
    if (!target?.getClientRects().length || target.closest('[aria-hidden="true"],[hidden]')) return {ok:false,error:'The requested form could not open.'};
    target.scrollIntoView({behavior:'smooth',block:'center'});
    return {...inspect(),opened:form,saved:false};
  }
  async function action({action} = {}) {
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
      return {...inspect(),activated:action,saved:false};
    }
    const section = document.querySelector('main section.active')?.id;
    const prefix = {service:'serviceHistory',docs:'docsHistory'}[section];
    const suffix = {show_filters:'FilterToggle',hide_filters:'FilterToggle',clear_filters:'ClearFilters',next_results:'Next',previous_results:'Prev'}[action];
    let target;
    if (prefix && suffix) target = $(prefix+suffix);
    else if (action === 'open_search') {
      const opened = await root.dkApp?.goToSection({section:'sage'});
      if (!opened?.ok) return opened || {ok:false,error:'Search could not open.'};
      target = $('dkSearchInput');
    } else if (action === 'close_search') target = $('dkSearchInput');
    if (!target || !target.getClientRects().length || target.disabled) return {ok:false,error:'That control is unavailable on the current page.'};
    if (action === 'open_search') { target.focus(); target.dispatchEvent(new Event('input',{bubbles:true})); }
    else if (action === 'close_search') target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else if (!suffix?.endsWith('Toggle') || target.getAttribute('aria-expanded') !== String(action === 'show_filters')) target.click();
    root.SageVoice?.minimize?.();
    return {...inspect(),activated:action,saved:false};
  }
  // Unambiguous simple UI requests skip a model round-trip. Values still use
  // the same live field validation/handlers; ambiguous speech goes to SageAI.
  function intent(raw) {
    const text = String(raw || '').trim().replace(/[.!?]+$/,'').replace(/^please\s+/i,'');
    if (/\b(?:don't|do not|never|not|how|why|earlier|said|say)\b/i.test(text)) return null;
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
    const set = text.match(/^(?:set|fill|enter|change)\s+(?:the )?(.+?)\s+(?:to|with|as)\s+(.+)$/i);
    if (!set) return null;
    const aliases = {odo:['odometer','odo','odo (km)'],cost:['cost','amount'],date:['date','service date'],nextDue:['next due','next due date'],notes:['notes']};
    const matches = [...fields()].filter(([id,el]) => visible(el) && editable(el) &&
      [label(el,id),...(aliases[el.name] || [])].some(name => normalize(name) === normalize(set[1])));
    if (matches.length !== 1) return null;
    const [id,el] = matches[0];
    try { return {name:'fill_page_fields',fields:[{field:id,value:validate(el,set[2]).value}]}; } catch { return null; }
  }
  root.SagePageControls = {inspect,fill,openForm,action,intent};
})(typeof self !== 'undefined' ? self : this);
