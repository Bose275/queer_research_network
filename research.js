(() => {
  'use strict';

  // ==================================================
  // SUPABASE CONFIGURATION
  // ==================================================

  const SUPABASE_URL =
    'https://shgbntwormbquafuezby.supabase.co';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_yAWT43eYKO_23L4CzjHpew_2Hsotj89';

  const grid = document.getElementById('research-grid');
  const count = document.getElementById('result-count');
  const search = document.getElementById('research-search');
  const topics = document.getElementById('topic-filter');
  const clear = document.getElementById('clear-filters');

  let projects = [];
  let client;

  // ==================================================
  // HTML AND URL HELPERS
  // ==================================================

  function escapeHTML(value = '') {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeUrl(value) {
    if (!value || !String(value).trim()) {
      return null;
    }

    try {
      const url = new URL(value, window.location.href);

      return ['https:', 'http:'].includes(url.protocol)
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  // ==================================================
  // RESEARCH TOPICS
  // ==================================================

  function projectTags(project) {
    return [
      ...new Set(
        (project.project_tags || [])
          .map(item => item.tags?.name)
          .filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));
  }

  // ==================================================
  // RESEARCHER PROFILE LINKS
  // ==================================================

  /*
    Each project can have two types of researchers:

    1. Linked researchers:
       Present in project_people with a published profile.

    2. Unlinked researchers:
       Listed by name in researcher_names without a profile.

    We preserve all names and only create clickable
    links when a relationship exists in project_people.
  */

  function normalizedName(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('en-CA');
  }

  function projectResearcherEntries(project) {
    const linked = (project.project_people || [])
      .filter(item =>
        item.people?.display_name &&
        item.people?.slug
      )
      .sort(
        (a, b) =>
          (a.display_order ?? 0) -
          (b.display_order ?? 0)
      );

    const names = Array.isArray(project.researcher_names)
      ? project.researcher_names.filter(
          name => typeof name === 'string' && name.trim()
        )
      : [];

    /*
      Preserve the names and their original order.

      Match a link to a listed name only when the
      approved profile name matches.

      Prefer the original position to distinguish
      repeated names. Allow unique-name matches
      if an older relationship has no matching position.
    */

    if (names.length) {
      const counts = new Map();

      for (const name of names) {
        const key = normalizedName(name);
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      return names.map((name, index) => {
        const key = normalizedName(name);

        const matches = linked.filter(
          item =>
            normalizedName(item.people.display_name) === key
        );

        const match =
          matches.find(
            item => item.display_order === index
          ) ||
          (
            matches.length === 1 &&
            counts.get(key) === 1
              ? matches[0]
              : null
          );

        return {
          name,
          slug: match?.people?.slug || null
        };
      });
    }

    /*
      Fallback for older projects that have linked
      profiles but no researcher_names array.
    */

    return linked.map(item => ({
      name: item.people.display_name,
      slug: item.people.slug
    }));
  }

  function projectResearchers(project) {
    return projectResearcherEntries(project)
      .map(entry => entry.name);
  }

  function linkedResearchersHTML(project) {
    return projectResearcherEntries(project)
      .map(entry => {
        const name = escapeHTML(entry.name);

        // Unlinked researcher: ordinary text.
        if (!entry.slug) {
          return `<span>${name}</span>`;
        }

        // Linked researcher: clickable profile.
        const href =
          `people.html#person-${encodeURIComponent(entry.slug)}`;

        return `
          <a
            href="${escapeHTML(href)}"
            title="View ${name}'s researcher profile"
          >${name}</a>
        `;
      })
      .join(', ');
  }

  // ==================================================
  // CREATE RESEARCH PROJECT CARD
  // ==================================================

  function makeCard(project) {
    const title = project.title || 'Research project';

    const names = projectResearchers(project);
    const researcherLinks = linkedResearchersHTML(project);

    const tags = projectTags(project);
    const image = safeUrl(project.image_url);
    const website = safeUrl(project.website_url);

    const brief =
      project.short_description ||
      project.description ||
      '';

    const hasDetails =
      project.description &&
      project.short_description &&
      project.description.trim() !==
        project.short_description.trim();

    return `
      <article class="research-card">

        ${
          image
            ? `
              <img
                class="project-image"
                src="${escapeHTML(image)}"
                alt=""
                loading="lazy"
              >
            `
            : ''
        }

        <div class="research-content">

          <div class="card-meta">
            <span>
              ${escapeHTML(project.project_type || 'Research project')}
            </span>

            ${
              project.is_featured
                ? '<span class="featured-badge">Featured</span>'
                : ''
            }
          </div>

          <h3>${escapeHTML(title)}</h3>

          ${
            names.length
              ? `
                <p class="project-researchers">
                  ${researcherLinks}
                </p>
              `
              : ''
          }

          ${
            project.institution
              ? `
                <p class="project-institution">
                  ${escapeHTML(project.institution)}
                </p>
              `
              : ''
          }

          ${
            brief
              ? `
                <p class="project-description">
                  ${escapeHTML(brief)}
                </p>
              `
              : ''
          }

          ${
            tags.length
              ? `
                <div
                  class="tag-list"
                  aria-label="Research topics"
                >
                  ${
                    tags
                      .map(
                        tag =>
                          `<span>${escapeHTML(tag)}</span>`
                      )
                      .join('')
                  }
                </div>
              `
              : ''
          }

          ${
            hasDetails
              ? `
                <details class="project-details">
                  <summary>
                    Read more
                    <span class="sr-only">
                      about ${escapeHTML(title)}
                    </span>
                  </summary>

                  <p>${escapeHTML(project.description)}</p>
                </details>
              `
              : ''
          }

          ${
            website
              ? `
                <a
                  class="card-link"
                  href="${escapeHTML(website)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Explore the project ↗
                  <span class="sr-only">
                    : ${escapeHTML(title)}
                    (opens in a new tab)
                  </span>
                </a>
              `
              : ''
          }

        </div>
      </article>
    `;
  }

  // ==================================================
  // SEARCH AND FILTER PROJECTS
  // ==================================================

  function render() {
    const terms = search.value
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const matches = projects.filter(project => {
      const haystack = [
        project.title,
        project.short_description,
        project.description,
        project.project_type,
        project.institution,
        ...projectResearchers(project),
        ...projectTags(project)
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();

      return terms.every(term => haystack.includes(term)) &&
        (
          !topics.value ||
          projectTags(project).includes(topics.value)
        );
    });

    count.textContent =
      `${matches.length} ` +
      `${matches.length === 1 ? 'project' : 'projects'}` +
      `${terms.length || topics.value ? ` of ${projects.length}` : ''}`;

    grid.innerHTML = matches.length
      ? matches.map(makeCard).join('')
      : `
        <div class="empty-state">
          <h3>
            ${
              projects.length
                ? 'No matching projects.'
                : 'Research is coming soon.'
            }
          </h3>

          <p>
            ${
              projects.length
                ? 'Try a different keyword or clear the filters.'
                : 'Published projects will appear here as they are added to the network.'
            }
          </p>
        </div>
      `;

    grid.querySelectorAll('.project-image').forEach(image => {
      const hide = () => {
        image.hidden = true;
      };

      image.addEventListener('error', hide, { once: true });

      if (image.complete && !image.naturalWidth) {
        hide();
      }
    });
  }

  function controls(enabled) {
    [search, topics, clear].forEach(control => {
      control.disabled = !enabled;
    });
  }

  // ==================================================
  // LOAD PUBLISHED PROJECTS FROM SUPABASE
  // ==================================================

  async function loadProjects() {
    grid.setAttribute('aria-busy', 'true');

    grid.innerHTML =
      '<p class="loading-message">Loading research projects…</p>';

    count.textContent = 'Loading research…';

    controls(false);

    try {
      if (!window.supabase?.createClient) {
        throw new Error(
          'Supabase library could not be loaded.'
        );
      }

      client ||= window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );

      const all = [];
      const pageSize = 500;

      /*
        Get all published projects.

        The new nested people fields include:
        id, slug, display_name

        The slug is used to construct the
        researcher's profile link.
      */

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from('research_projects')
          .select(`
            id,
            title,
            short_description,
            description,
            project_type,
            institution,
            website_url,
            image_url,
            researcher_names,
            is_featured,
            display_order,

            project_tags (
              tags (
                name
              )
            ),

            project_people (
              display_order,
              people (
                id,
                slug,
                display_name
              )
            )
          `)
          .eq('status', 'published')
          .order('display_order', { ascending: true })
          .order('title', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);

        if (error) throw error;

        all.push(...(data || []));

        if (!data || data.length < pageSize) {
          break;
        }
      }

      projects = all;

      const selectedTopic = topics.value;

      const names = [
        ...new Set(projects.flatMap(projectTags))
      ].sort((a, b) => a.localeCompare(b));

      topics.replaceChildren(
        new Option('All topics', ''),
        ...names.map(name => new Option(name, name))
      );

      if (names.includes(selectedTopic)) {
        topics.value = selectedTopic;
      }

      controls(true);
      render();

    } catch (error) {
      console.error(
        'Could not load research projects:',
        error
      );

      count.textContent =
        'Research is temporarily unavailable.';

      grid.innerHTML = `
        <div class="error-state">
          <h3>Let’s try that again.</h3>
          <p>
            We couldn’t load the research projects.
            Please try again in a moment.
          </p>
          <button class="button" id="retry" type="button">
            Try again
          </button>
        </div>
      `;

      document
        .getElementById('retry')
        .addEventListener('click', () => {
          if (window.supabase?.createClient) {
            loadProjects();
          } else {
            window.location.reload();
          }
        });

    } finally {
      grid.setAttribute('aria-busy', 'false');
    }
  }

  // ==================================================
  // EVENT LISTENERS
  // ==================================================

  document
    .querySelector('.filters')
    .addEventListener('submit', event => {
      event.preventDefault();
    });

  search.addEventListener('input', render);

  topics.addEventListener('change', render);

  clear.addEventListener('click', () => {
    search.value = '';
    topics.value = '';
    render();
    search.focus();
  });

  // Start loading.
  loadProjects();

})();