// Dropdown nav behavior — click to open, click outside or Escape to close.
document.addEventListener("DOMContentLoaded", () => {
  const triggers = document.querySelectorAll(".nav-trigger");

  function closeAll(except) {
    triggers.forEach((t) => {
      if (t !== except) {
        t.classList.remove("open");
        const mega = document.getElementById(t.getAttribute("aria-controls"));
        if (mega) mega.classList.remove("open");
      }
    });
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const mega = document.getElementById(trigger.getAttribute("aria-controls"));
      const isOpen = trigger.classList.contains("open");
      closeAll(trigger);
      if (mega) {
        trigger.classList.toggle("open", !isOpen);
        mega.classList.toggle("open", !isOpen);
      }
    });
  });

  document.addEventListener("click", () => closeAll(null));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll(null);
  });

  // Category filter pills + search box (used on the homepage tool
  // directory). No-op on pages that don't have this markup.
  const pills = document.querySelectorAll(".pill[data-filter]");
  const sections = document.querySelectorAll(".filter-section");
  const searchInput = document.getElementById("tool-search");
  const noResults = document.getElementById("no-results");

  if (pills.length && sections.length) {
    let activeCategory = "all";
    let searchTerm = "";

    function applyFilters() {
      let anyVisible = false;

      sections.forEach((section) => {
        const categoryMatches = activeCategory === "all" || section.dataset.category === activeCategory;
        const sectionCards = section.querySelectorAll(".tool-card[data-name]");
        let sectionHasMatch = false;

        sectionCards.forEach((card) => {
          const nameMatches = !searchTerm || card.dataset.name.includes(searchTerm);
          const show = categoryMatches && nameMatches;
          card.style.display = show ? "" : "none";
          if (show) sectionHasMatch = true;
        });

        const show = categoryMatches && sectionHasMatch;
        if (show) {
          section.hidden = false;
          requestAnimationFrame(() => section.classList.remove("fading"));
          anyVisible = true;
        } else {
          section.classList.add("fading");
          setTimeout(() => { section.hidden = true; }, 200);
        }
      });

      if (noResults) noResults.classList.toggle("show", !anyVisible);
    }

    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        activeCategory = pill.getAttribute("data-filter");
        applyFilters();
      });
    });

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchTerm = searchInput.value.trim().toLowerCase();
        applyFilters();
      });
    }
  }
});
