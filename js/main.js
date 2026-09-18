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

  // Category filter pills (used on /tools.html). No-op on pages that
  // don't have this markup.
  const pills = document.querySelectorAll(".pill[data-filter]");
  const sections = document.querySelectorAll(".filter-section");
  if (pills.length && sections.length) {
    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        const target = pill.getAttribute("data-filter");

        sections.forEach((section) => {
          const matches = target === "all" || section.dataset.category === target;
          if (matches) {
            section.hidden = false;
            requestAnimationFrame(() => section.classList.remove("fading"));
          } else {
            section.classList.add("fading");
            setTimeout(() => { section.hidden = true; }, 200);
          }
        });
      });
    });
  }
});
