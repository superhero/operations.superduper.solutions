export function startApplication(documentRef, component, mountComponent)
{
  const target = documentRef.querySelector("#app");

  if (!target)
  {
    throw new Error("Missing #app element");
  }

  return mountComponent(component, { target });
}
