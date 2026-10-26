
(() => {
  'use strict';

  const form = document.getElementById('profile-form');
  if (!form) return;

  const status = document.getElementById('form-status');
  const button = document.getElementById('profile-submit');
  const nameInput = document.getElementById('profile-display-name');
  const matchStatus = document.getElementById('project-match-status');
  const matchOptions = document.getElementById('project-match-options');

  const photoInput = document.getElementById('profile-photo');
  const photoCanvas = document.getElementById('photo-canvas');
  const cropControls = document.getElementById('photo-crop-controls');
  const photoConsentWrap = document.getElementById('photo-consent-wrap');
  const photoConsent = form.elements.photo_consent;

  let client;
  let sending = false;
  let sourceImage = null;
  let sourceObjectUrl = null;

  let projectCachePromise = null;
  let matchTimer = null;
  let searchVersion = 0;

  const selectedProjectIds = new Set();

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
  }

  function setDisabled(disabled) {
    form.querySelectorAll('fieldset').forEach(fieldset => {
      fieldset.disabled = disabled;
    });

    button.disabled = disabled;
    form.setAttribute(
      'aria-busy',
      String(disabled && sending)
    );
  }

  function normalizeName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLocaleLowerCase('en-CA');
  }

  // =====================================================
  // FIND PROJECTS THAT LIST THE RESEARCHER'S NAME
  // =====================================================

  async function fetchPublishedProjects() {
    if (projectCachePromise) return projectCachePromise;

    projectCachePromise = (async () => {
      const projects = [];
      const pageSize = 500;

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from('research_projects')
          .select('id, title, institution, researcher_names')
          .eq('status', 'published')
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        projects.push(...(data || []));

        if (!data || data.length < pageSize) break;
      }

      return projects;
    })().catch(error => {
      projectCachePromise = null;
      throw error;
    });

    return projectCachePromise;
  }

  async function searchProjects() {
    const version = ++searchVersion;
    const key = normalizeName(nameInput.value);

    selectedProjectIds.clear();
    matchOptions.replaceChildren();

    if (key.length < 2 || !client) {
      matchStatus.textContent =
        'Enter your display name above to look for projects.';
      return;
    }

    matchStatus.textContent =
      'Looking for projects that list your name…';

    try {
      const projects = await fetchPublishedProjects();

      if (version !== searchVersion || sending) return;

      const matches = projects.filter(project =>
        Array.isArray(project.researcher_names) &&
        project.researcher_names.some(
          name => normalizeName(name) === key
        )
      );

      if (!matches.length) {
        matchStatus.textContent =
          'No existing projects list that exact name. You can still submit your profile.';
        return;
      }

      matchStatus.textContent =
        `${matches.length} possible ` +
        `${matches.length === 1 ? 'project' : 'projects'} found. ` +
        'Select any that are yours:';

      for (const project of matches) {
        const label = document.createElement('label');
        label.className = 'profile-project-choice';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = project.id;

        checkbox.setAttribute(
          'aria-label',
          `Link to ${project.title}`
        );

        const details = document.createElement('span');
        const title = document.createElement('strong');

        title.textContent =
          project.title || 'Research project';

        details.append(title);

        if (project.institution) {
          const institution = document.createElement('small');
          institution.textContent = project.institution;
          details.append(institution);
        }

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            if (selectedProjectIds.size >= 20) {
              checkbox.checked = false;
              matchStatus.textContent =
                'Choose no more than 20 projects.';
              return;
            }

            selectedProjectIds.add(project.id);
          } else {
            selectedProjectIds.delete(project.id);
          }
        });

        label.append(checkbox, details);
        matchOptions.append(label);
      }
    } catch (error) {
      if (version !== searchVersion || sending) return;

      console.error('Project suggestions failed:', error);

      matchStatus.textContent =
        'Project matching is temporarily unavailable. You can still submit your profile.';
    }
  }

  // Search automatically as the name is typed.
  nameInput.addEventListener('input', () => {
    clearTimeout(matchTimer);
    ++searchVersion;

    selectedProjectIds.clear();
    matchOptions.replaceChildren();

    matchStatus.textContent =
      'Looking for projects…';

    matchTimer = setTimeout(searchProjects, 350);
  });

  // =====================================================
  // OPTIONAL PROFILE PHOTO AND SQUARE CROP
  // =====================================================

  function clearPhoto() {
    sourceImage = null;

    if (sourceObjectUrl) {
      URL.revokeObjectURL(sourceObjectUrl);
    }

    sourceObjectUrl = null;
    cropControls.hidden = true;
    photoConsentWrap.hidden = true;
    photoConsent.required = false;
    photoConsent.checked = false;
  }

  function drawSquareCrop() {
    if (!sourceImage || !photoCanvas) return;

    const width = sourceImage.naturalWidth;
    const height = sourceImage.naturalHeight;
    const side = Math.min(width, height);

    const xPct =
      Number(document.getElementById('photo-x').value) / 100;

    const yPct =
      Number(document.getElementById('photo-y').value) / 100;

    const sx = (width - side) * xPct;
    const sy = (height - side) * yPct;

    const context = photoCanvas.getContext(
      '2d',
      { alpha: false }
    );

    context.clearRect(0, 0, 600, 600);

    context.drawImage(
      sourceImage,
      sx,
      sy,
      side,
      side,
      0,
      0,
      600,
      600
    );
  }

  photoInput.addEventListener('change', () => {
    clearPhoto();

    const file = photoInput.files?.[0];
    if (!file) return;

    if (
      !['image/jpeg', 'image/png', 'image/webp']
        .includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      photoInput.value = '';

      message(
        'Choose a JPG, PNG, or WebP photo smaller than 8 MB.',
        true
      );

      return;
    }

    sourceObjectUrl = URL.createObjectURL(file);

    const currentImage = new Image();
    sourceImage = currentImage;

    currentImage.onload = () => {
      if (sourceImage !== currentImage) return;

      if (
        currentImage.naturalWidth *
        currentImage.naturalHeight > 20_000_000
      ) {
        photoInput.value = '';
        clearPhoto();

        message(
          'That image is too large to process. Please choose a smaller image.',
          true
        );

        return;
      }

      cropControls.hidden = false;
      photoConsentWrap.hidden = false;
      photoConsent.required = true;

      document.getElementById('photo-x').value = '50';
      document.getElementById('photo-y').value = '50';

      drawSquareCrop();
      message('');
    };

    currentImage.onerror = () => {
      if (sourceImage !== currentImage) return;

      photoInput.value = '';
      clearPhoto();

      message(
        'We couldn’t open that image. Please choose another photo.',
        true
      );
    };

    currentImage.src = sourceObjectUrl;
  });

  document
    .getElementById('photo-x')
    .addEventListener('input', drawSquareCrop);

  document
    .getElementById('photo-y')
    .addEventListener('input', drawSquareCrop);

  function makeSquareJpeg() {
    if (!sourceImage?.naturalWidth || cropControls.hidden) {
      return Promise.reject(
        new Error('Please allow your photo to finish loading.')
      );
    }

    return new Promise((resolve, reject) => {
      photoCanvas.toBlob(
        blob =>
          blob
            ? resolve(blob)
            : reject(
                new Error('Could not prepare the profile photo.')
              ),
        'image/jpeg',
        0.86
      );
    });
  }

  async function uploadSquarePhoto(blob, path) {
    const config = window.QRN_CONFIG;
    const key = config.publishableKey;

    const result = await fetch(
      `${config.supabaseUrl}/functions/v1/qrn-profile-photo-upload`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'content-type': 'image/jpeg',
          'x-photo-path': path
        },
        body: blob
      }
    );

    let data = {};

    try {
      data = await result.json();
    } catch {
      // Response is not JSON.
    }

    if (!result.ok || !data.ok) {
      throw new Error(
        data.error ||
        'The photo upload failed. Try again or submit without a photo.'
      );
    }

    return data.path;
  }

  // =====================================================
  // COLLECT AND VALIDATE FORM DATA
  // =====================================================

  function collectPayload() {
    const data = new FormData(form);
    const payload = {};

    const limits = {
      display_name: 150,
      pronouns: 100,
      role_type: 150,
      title: 200,
      institution: 200,
      faculty: 200,
      department: 200,
      bio: 3000,
      website_url: 2048,
      orcid_url: 2048,
      linkedin_url: 2048,
      submitter_email: 254
    };

    for (const [field, limit] of Object.entries(limits)) {
      const value = String(
        data.get(field) || ''
      ).trim();

      if (Array.from(value).length > limit) {
        throw new Error(
          `Please shorten the ${field.replaceAll('_', ' ')} field.`
        );
      }

      payload[field] = value || null;
    }

    if (!payload.display_name) {
      throw new Error(
        'Please enter your display name.'
      );
    }

    if (
      !payload.submitter_email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        payload.submitter_email
      )
    ) {
      throw new Error(
        'Please enter a valid contact email address.'
      );
    }

    for (const field of [
      'website_url',
      'orcid_url',
      'linkedin_url'
    ]) {
      if (!payload[field]) continue;

      let url;

      try {
        url = new URL(payload[field]);
      } catch {
        throw new Error(
          'Please enter links beginning with https:// or http://.'
        );
      }

      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error(
          'Public links must use http(s) and cannot contain passwords.'
        );
      }

      payload[field] = url.href;
    }

    // Research interests.
    const interests = [
      ...data.getAll('selected_tags'),
      ...String(
        data.get('other_tags') || ''
      ).split(',')
    ];

    const uniqueTags = new Map();

    for (const interest of interests) {
      const tag = String(interest).trim();

      if (!tag) continue;

      if (Array.from(tag).length > 80) {
        throw new Error(
          'Keep each research interest to 80 characters or fewer.'
        );
      }

      uniqueTags.set(
        tag.toLocaleLowerCase('en-CA'),
        tag
      );
    }

    if (uniqueTags.size > 20) {
      throw new Error(
        'Select or suggest no more than 20 research interests.'
      );
    }

    payload.suggested_tags = [
      ...uniqueTags.values()
    ];

    // ===============================================
    // NEW: REQUESTED PROJECT CONNECTIONS
    // ===============================================

    // These are project IDs selected by the researcher.
    // They are requests for QRN review, not verified links.

    payload.suggested_project_ids = [
      ...selectedProjectIds
    ];

    // ===============================================
    // CONSENT
    // ===============================================

    payload.consent_to_publish =
      data.get('consent_to_publish') === 'on';

    if (!payload.consent_to_publish) {
      throw new Error(
        'Please give permission to publish your profile.'
      );
    }

    payload.photo_consent =
      data.get('photo_consent') === 'on';

    if (
      photoInput.files?.length &&
      !payload.photo_consent
    ) {
      throw new Error(
        'Please consent to publishing the photo, or remove it.'
      );
    }

    return payload;
  }

  // =====================================================
  // LOAD RESEARCH INTERESTS
  // =====================================================

  async function loadTags() {
    const container = document.getElementById(
      'tag-options'
    );

    try {
      const { data, error } = await client
        .from('tags')
        .select('name, category')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      container.replaceChildren();

      for (const tag of data || []) {
        const label = document.createElement('label');
        const input = document.createElement('input');

        input.type = 'checkbox';
        input.name = 'selected_tags';
        input.value = tag.name;

        label.append(
          input,
          document.createTextNode(tag.name)
        );

        container.append(label);
      }

      if (!data?.length) {
        container.textContent =
          'Add your research interests below.';
      }
    } catch (error) {
      console.error(
        'Loading tags failed:',
        error
      );

      container.textContent =
        'We couldn’t load the topic list. You can still write your interests below.';
    }
  }

  // =====================================================
  // SUBMIT PROFILE
  // =====================================================

  form.addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      if (
        sending ||
        !client ||
        !form.reportValidity()
      ) {
        return;
      }

      let payload;

      try {
        payload = collectPayload();
      } catch (error) {
        message(error.message, true);
        status.focus();
        return;
      }

      sending = true;
      ++searchVersion;
      clearTimeout(matchTimer);
      setDisabled(true);

      button.textContent = 'Submitting…';

      message(
        'Sending your profile for review…'
      );

      try {
        // ==========================================
        // OPTIONAL PHOTO UPLOAD
        // ==========================================

        if (photoInput.files?.length) {
          message(
            'Preparing and uploading your square photo…'
          );

          const imageBlob = await makeSquareJpeg();

          const nameSlug = payload.display_name
            .toLowerCase()
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

          const path =
            `profile-submissions/${nameSlug}.jpg`;

          payload.photo_path =
            await uploadSquarePhoto(imageBlob, path);

        } else {
          payload.photo_path = null;
        }

        // ==========================================
        // SAVE SUBMISSION TO SUPABASE
        // ==========================================

        message(
          'Sending your profile for review…'
        );

        const { error } = await client
          .from('profile_submissions')
          .insert(payload);

        if (error) {
          console.error(
            'Profile submission failed:',
            error
          );

          const missing = [
            'PGRST204',
            '42703'
          ].includes(error.code);

          message(
            missing
              ? 'The profile form needs a database update before project suggestions can be saved.'
              : 'We couldn’t confirm your submission. Your entries are still here. Please try again or contact the network organizer.',
            true
          );

          status.focus();
          return;
        }

        // ==========================================
        // SUCCESS
        // ==========================================

        form.reset();
        clearPhoto();

        selectedProjectIds.clear();
        matchOptions.replaceChildren();

        form.hidden = true;

        message('');

        const success = document.getElementById(
          'profile-success'
        );

        success.hidden = false;
        success.focus();

      } catch (error) {
        console.error(
          'PROFILE SUBMISSION ERROR:',
          error
        );

        message(
          error?.message ||
          'We couldn’t confirm your submission. Please try again.',
          true
        );

        status.focus();

      } finally {
        sending = false;

        form.setAttribute(
          'aria-busy',
          'false'
        );

        if (!form.hidden) {
          setDisabled(false);
        }

        button.textContent =
          'Submit for review →';
      }
    }
  );

  // =====================================================
  // INITIALIZE
  // =====================================================

  async function initialize() {
    const config = window.QRN_CONFIG;

    if (
      !window.supabase?.createClient ||
      !config ||
      config.supabaseUrl.includes('YOUR-') ||
      config.publishableKey.includes('YOUR-') ||
      !config.publishableKey.startsWith(
        'sb_publishable_'
      )
    ) {
      message(
        'This form is still being set up. Check supabase-config.js.',
        true
      );
      return;
    }

    try {
      client = window.supabase.createClient(
        config.supabaseUrl,
        config.publishableKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        }
      );

      await loadTags();

      setDisabled(false);
      message('');

    } catch (error) {
      console.error(
        'Profile form initialization failed:',
        error
      );

      client = null;

      message(
        'This form is temporarily unavailable. Please try again later.',
        true
      );
    }
  }

  initialize();
})();
