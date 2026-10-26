
(() => {
  'use strict';

  // Browser-safe Supabase credentials only. Never use a service_role key here.
  const CONFIG = {
    supabaseUrl: 'https://shgbntwormbquafuezby.supabase.co',
    publishableKey: 'sb_publishable_yAWT43eYKO_23L4CzjHpew_2Hsotj89'
  };

  const form = document.getElementById('research-form');
  if (!form) return;

  const status = document.getElementById('form-status');
  const submitButton = document.getElementById('research-submit');
  const summary = document.getElementById('short-description');
  const image = document.getElementById('image-url');
  const imageConsent = document.getElementById('image-consent');

  const researcherInput = document.getElementById('researcher-input');
  const addResearcherButton = document.getElementById('add-researcher');
  const researcherList = document.getElementById('researcher-list');
  const researcherHidden = document.getElementById('researcher-names-hidden');
  const researcherError = document.getElementById('researcher-error');
  const resultsPanel = document.getElementById('researcher-results');
  const suggestions = document.getElementById('researcher-suggestions');
  const searchStatus = document.getElementById('researcher-search-status');

  let client;
  let sending = false;
  let lastPayload = null;
  let requestId = null;
  let researchers = []; // [{ name: string, person_id: UUID | null }]
  let searchTimer;
  let searchVersion = 0;

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
  }

  function normalizeName(value) {
    return value.trim().replace(/\s+/gu, ' ');
  }

  function nameKey(value) {
    return value.toLocaleLowerCase('en-CA');
  }

  function hideSuggestions() {
    clearTimeout(searchTimer);
    searchVersion++;
    resultsPanel.hidden = true;
    suggestions.replaceChildren();
    searchStatus.textContent = '';
  }

  function updateResearchers() {
    researcherList.replaceChildren();

    researchers.forEach((entry, index) => {
      const item = document.createElement('li');
      const textWrap = document.createElement('div');
      const name = document.createElement('span');
      const description = document.createElement('small');
      const remove = document.createElement('button');

      name.textContent = entry.name;
      description.textContent = entry.person_id
        ? 'Existing profile selected'
        : 'Name only — not linked to a profile';
      description.className = entry.person_id ? 'researcher-linked' : '';
      textWrap.append(name, description);

      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${entry.name}`);
      remove.disabled = sending;
      remove.addEventListener('click', () => {
        if (sending) return;
        researchers.splice(index, 1);
        updateResearchers();
      });

      item.append(textWrap, remove);
      researcherList.append(item);
    });

    // Maintain the old field for compatibility with your current review queue.
    researcherHidden.value = researchers.map(x => x.name).join('\n');
    addResearcherButton.disabled = sending || researchers.length >= 20;
    researcherError.textContent = '';
  }

  function addEntry(nameValue, personId = null) {
    if (sending) return false;
    const name = normalizeName(nameValue);

    if (!name) {
      researcherError.textContent = 'Enter a researcher or team name.';
      researcherInput.focus();
      return false;
    }
    if (Array.from(name).length > 150) {
      researcherError.textContent = 'Keep each name to 150 characters or fewer.';
      researcherInput.focus();
      return false;
    }
    // If a previously entered unlinked name gets a profile match, upgrade it.
    if (personId) {
      const unlinkedMatch = researchers.find(x =>
        !x.person_id && nameKey(x.name) === nameKey(name)
      );
      if (unlinkedMatch) {
        unlinkedMatch.name = name;
        unlinkedMatch.person_id = personId;
        researcherInput.value = '';
        hideSuggestions();
        updateResearchers();
        researcherInput.focus();
        return true;
      }
    }
    // Distinguish different published profiles even if they share a name.
    const duplicate = personId
      ? researchers.some(x => x.person_id === personId)
      : researchers.some(x => nameKey(x.name) === nameKey(name));
    if (duplicate) {
      researcherError.textContent = 'This researcher or team has already been added.';
      researcherInput.focus();
      return false;
    }
    if (researchers.length >= 20 ||
        [...researchers.map(x => x.name), name].join('\n').length > 3020) {
      researcherError.textContent = 'You can add up to 20 researchers or teams.';
      return false;
    }

    researchers.push({ name, person_id: personId });
    researcherInput.value = '';
    hideSuggestions();
    updateResearchers();
    researcherInput.focus();
    return true;
  }

  function addManualName() {
    addEntry(researcherInput.value, null);
  }

  function validateResearchers() {
    if (!researchers.length) {
      researcherError.textContent = 'Add at least one researcher or team.';
    } else if (researcherInput.value.trim()) {
      researcherError.textContent =
        'Select a profile or click + Add name to include the name you typed.';
    } else {
      researcherError.textContent = '';
      return true;
    }
    researcherInput.focus();
    return false;
  }

  function renderSuggestions(people) {
    suggestions.replaceChildren();
    resultsPanel.hidden = false;

    if (!people.length) {
      searchStatus.textContent =
        'No matching profiles found. You can add this name without a profile.';
      return;
    }
    searchStatus.textContent = 'Matching researcher profiles:';

    for (const person of people) {
      const row = document.createElement('li');
      const option = document.createElement('button');
      const name = document.createElement('strong');
      const affiliation = document.createElement('small');

      option.type = 'button';
      option.className = 'researcher-suggestion';
      name.textContent = person.display_name;
      affiliation.textContent = person.institution || 'View this profile match';
      option.append(name, affiliation);
      option.addEventListener('click', () => addEntry(person.display_name, person.id));
      row.append(option);
      suggestions.append(row);
    }
  }

  // Search only public profiles. Do not infer an identity from a matching name.
  function scheduleProfileSearch() {
    clearTimeout(searchTimer);
    const version = ++searchVersion;
    const input = normalizeName(researcherInput.value);
    const cleaned = input.replace(/[%_\\]/g, ''); // treat SQL wildcard chars as plain input
    researcherError.textContent = '';
    suggestions.replaceChildren();

    if (cleaned.length < 2 || researchers.length >= 20 || !client) {
      resultsPanel.hidden = true;
      searchStatus.textContent = '';
      return;
    }

    resultsPanel.hidden = false;
    searchStatus.textContent = 'Searching for existing profiles…';

    searchTimer = setTimeout(async () => {
      try {
        const { data, error } = await client
          .from('people')
          .select('id, display_name, institution')
          .eq('status', 'published')
          .ilike('display_name', `%${cleaned}%`)
          .order('display_name')
          .limit(10);
        if (error) throw error;
        if (version !== searchVersion || sending) return;
        renderSuggestions(data || []);
      } catch (error) {
        if (version !== searchVersion || sending) return;
        resultsPanel.hidden = false;
        suggestions.replaceChildren();
        searchStatus.textContent =
          'Profiles could not be searched right now. You can still add a name without a profile.';
        console.error('Researcher profile search failed:', error);
      }
    }, 250);
  }

  addResearcherButton.addEventListener('click', addManualName);
  researcherInput.addEventListener('input', scheduleProfileSearch);
  researcherInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideSuggestions();
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      // Enter means add unlinked name; selecting a profile requires clicking its result.
      addManualName();
    }
  });

  function setDisabled(value) {
    form.querySelectorAll('fieldset').forEach(fieldset => {
      fieldset.disabled = value;
    });
    researcherInput.disabled = value;
    addResearcherButton.disabled = value || researchers.length >= 20;
    researcherList.querySelectorAll('button').forEach(b => { b.disabled = value; });
    if (value) hideSuggestions();
    submitButton.disabled = value;
    form.setAttribute('aria-busy', String(value && sending));
  }

  function updateImageConsent() {
    const wrap = document.getElementById('image-consent-wrap');
    if (!image || !imageConsent || !wrap) return;
    const hasImage = Boolean(image.value.trim());
    wrap.hidden = !hasImage;
    imageConsent.required = hasImage;
    if (!hasImage) imageConsent.checked = false;
  }
  image?.addEventListener('input', updateImageConsent);

  summary?.addEventListener('input', () => {
    document.getElementById('summary-count').textContent =
      `${summary.value.length} / 600 characters`;
  });

  function collectPayload() {
    const data = new FormData(form);
    if (String(data.get('company_website') || '').trim()) {
      throw new Error('We couldn’t accept this submission. Please contact the network organizer.');
    }

    const payload = {};
    const limits = {
      title: 250, project_type: 100, institution: 200,
      short_description: 600, description: 6000, website_url: 2048,
      image_url: 2048, submitter_name: 150, submitter_email: 254
    };
    for (const [field, limit] of Object.entries(limits)) {
      const value = String(data.get(field) || '').trim();
      if (Array.from(value).length > limit) {
        throw new Error(`Please shorten the ${field.replaceAll('_', ' ')} field.`);
      }
      payload[field] = value || null;
    }

    for (const field of ['title', 'project_type', 'short_description', 'submitter_name']) {
      if (!payload[field]) {
        throw new Error(`Please enter the ${field.replaceAll('_', ' ')}.`);
      }
    }
    if (!payload.submitter_email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitter_email)) {
      throw new Error('Please enter a valid contact email address.');
    }

    for (const field of ['website_url', 'image_url']) {
      if (!payload[field]) continue;
      let url;
      try { url = new URL(payload[field]); }
      catch { throw new Error('Please enter complete links beginning with https:// or http://.'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Public links must use https:// or http:// and cannot include passwords.');
      }
      payload[field] = url.href;
      if (payload[field].length > limits[field]) {
        throw new Error('Please use a shorter public link.');
      }
    }

    if (!researchers.length || researchers.length > 20 ||
        researchers.some(x => Array.from(x.name).length > 150)) {
      throw new Error('Add 1–20 researcher or team names, up to 150 characters each.');
    }
    payload.researcher_names = researchers.map(x => x.name);
    // This JSONB column must exist in research_submissions before deployment.
    // These are proposed links only; project approval must validate IDs.
    payload.researcher_entries = researchers.map(({ name, person_id }) => ({
      name, person_id
    }));

    const tags = new Map();
    for (const entry of [
      ...data.getAll('selected_tags'),
      ...String(data.get('other_tags') || '').split(',')
    ]) {
      const tag = String(entry).trim();
      if (!tag) continue;
      if (Array.from(tag).length > 80) {
        throw new Error('Please keep each research topic to 80 characters or fewer.');
      }
      tags.set(tag.toLocaleLowerCase('en-CA'), tag);
    }
    if (tags.size > 20) {
      throw new Error('Please select or suggest no more than 20 research topics.');
    }
    payload.suggested_tags = [...tags.values()];

    payload.image_consent = Boolean(payload.image_url) &&
      data.get('image_consent') === 'on';
    if (payload.image_url && !payload.image_consent) {
      throw new Error('Please give permission to display the image, or remove its URL.');
    }
    payload.consent_to_publish = data.get('consent_to_publish') === 'on';
    if (!payload.consent_to_publish) {
      throw new Error('Please give permission to publish your project before submitting.');
    }

    const serialized = JSON.stringify(payload);
    if (serialized !== lastPayload) {
      requestId = crypto.randomUUID();
      lastPayload = serialized;
    }
    payload.request_id = requestId;
    return payload;
  }

  async function loadTags() {
    const container = document.getElementById('tag-options');
    try {
      const { data, error } = await client
        .from('tags')
        .select('name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      for (const tag of data || []) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'selected_tags';
        input.value = tag.name;
        label.append(input, document.createTextNode(tag.name));
        container.append(label);
      }
      if (!data?.length) container.textContent = 'Add your research topics below.';
    } catch (error) {
      container.textContent =
        'We couldn’t load the topic list. You can still write your topics below.';
      console.error('Loading research topics failed:', error);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    updateImageConsent();
    if (sending || !client || !form.reportValidity()) return;
    if (!validateResearchers()) return;

    let payload;
    try { payload = collectPayload(); }
    catch (error) {
      message(error.message, true);
      status.focus();
      return;
    }

    sending = true;
    setDisabled(true);
    submitButton.textContent = 'Submitting…';
    message('Sending your research for review…');

    try {
      const { error } = await client.from('research_submissions').insert(payload);
      if (error && error.code !== '23505') {
        const missingColumn = error.code === 'PGRST204' || error.code === '42703';
        const unavailable = ['42501', '42P01', 'PGRST205', 'PGRST301', 'PGRST302']
          .includes(error.code);
        const invalid = ['22023', '23514', '23502'].includes(error.code);
        console.error('Research submission failed:', error);
        message(missingColumn
          ? 'The research submission form needs a database update. Please contact the network organizer.'
          : unavailable
            ? 'This form isn’t accepting submissions right now. Your entries are still here; please contact the network organizer.'
            : invalid
              ? 'Please check your entries and publishing permissions, then try again.'
              : 'We couldn’t confirm your submission. Your entries are still here. You can retry or contact the organizer.', true);
        status.focus();
        return;
      }

      form.reset();
      researchers = [];
      researcherInput.value = '';
      hideSuggestions();
      updateResearchers();
      form.hidden = true;
      message('');
      const success = document.getElementById('research-success');
      success.hidden = false;
      success.focus();
    } catch (error) {
      console.error('Research submission network error:', error);
      message('We couldn’t confirm your submission. Your entries are still here. Please try again.', true);
      status.focus();
    } finally {
      sending = false;
      form.setAttribute('aria-busy', 'false');
      if (!form.hidden) setDisabled(false);
      submitButton.textContent = 'Submit for review →';
    }
  });

  async function initialize() {
    if (!window.supabase?.createClient || !globalThis.crypto?.randomUUID) {
      message('The form couldn’t load. Please use a current browser over HTTPS and try again.', true);
      return;
    }
    try {
      client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      await loadTags();
      updateImageConsent();
      updateResearchers();
      setDisabled(false);
      message('');
    } catch (error) {
      client = null;
      console.error('Research form initialization failed:', error);
      message('This form is temporarily unavailable. Please try again later.', true);
    }
  }

  initialize();
})();
