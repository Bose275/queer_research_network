
document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("header-container");
  if (!container) return;

  try {
    const response = await fetch("/header.html");
    if (!response.ok) throw new Error("Failed to load header");

    container.innerHTML = await response.text();

    // ==========================================
    // UPCOMING EVENT ANNOUNCEMENT
    // ==========================================

    async function updateAnnouncement() {
      const link = container.querySelector("#announcement-link");
      if (!link) return;

      try {
        const supabaseUrl =
          "https://shgbntwormbquafuezby.supabase.co";

        const publishableKey =
          "sb_publishable_yAWT43eYKO_23L4CzjHpew_2Hsotj89";

        const url = new URL("/rest/v1/events", supabaseUrl);

        url.searchParams.set(
          "select",
          "slug,title,starts_at,timezone"
        );
        url.searchParams.set("status", "eq.published");
        url.searchParams.set(
          "starts_at",
          `gte.${new Date().toISOString()}`
        );
        url.searchParams.set("order", "starts_at.asc");
        url.searchParams.set("limit", "1");

        const response = await fetch(url, {
          headers: {
            apikey: publishableKey
          }
        });

        if (!response.ok) {
          throw new Error("Could not fetch upcoming event");
        }

        const events = await response.json();
        if (!events.length) return;

        const event = events[0];

        const date = new Intl.DateTimeFormat("en-CA", {
          month: "short",
          day: "numeric",
          timeZone: event.timezone || "America/Edmonton"
        }).format(new Date(event.starts_at));

        link.textContent = `${event.title} on ${date}`;

        link.href =
          `/index.html#event-${encodeURIComponent(event.slug)}`;

      } catch (error) {
        console.error("Announcement loading error:", error);
      }
    }

    updateAnnouncement();

    // ==========================================
    // 1. Highlight the current page
    // ==========================================

    const currentPage =
      window.location.pathname.split("/").pop() || "index.html";

    container.querySelectorAll(".primary-nav a").forEach(link => {
      const url = new URL(link.href);
      const linkPage = url.pathname.split("/").pop();

      if (linkPage === currentPage && !url.hash) {
        link.setAttribute("aria-current", "page");
      }
    });

    // ==========================================
    // 2. Logo fallback
    // ==========================================

    const logo = container.querySelector("img.brand-mark");
    const fallback = container.querySelector(".brand-fallback");

    if (logo && fallback) {
      function showBrandText() {
        logo.hidden = true;
        logo.style.display = "none";
        fallback.hidden = false;
      }

      logo.addEventListener("error", showBrandText, {
        once: true
      });

      if (logo.complete && !logo.naturalWidth) {
        showBrandText();
      }
    }

  } catch (error) {
    console.error("Header loading error:", error);
  }
});

