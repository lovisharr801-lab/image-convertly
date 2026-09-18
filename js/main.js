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
});
