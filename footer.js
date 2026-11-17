document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("footer-container");
  if (!container) return;

  try {
    const response = await fetch("/footer.html");
    if (!response.ok) throw new Error("Failed to load footer");

    container.innerHTML = await response.text();
  } catch (error) {
    console.error("Footer loading error:", error);
  }
});