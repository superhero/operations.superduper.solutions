const app = document.querySelector<HTMLElement>("#app");

if (!app)
{
  throw new Error("Missing #app element");
}

app.textContent = "operations.superduper.solutions";
