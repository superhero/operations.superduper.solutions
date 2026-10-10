import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { startApplication } from "./bootstrap.ts";
import { palettes } from "./components/SettingsWorkspace.svelte";
import { loadSettings } from "./lib/app-settings.ts";

const settings = await loadSettings(palettes.map(palette => palette.id));
document.documentElement.dataset.theme = settings.theme;
document.documentElement.dataset.palette = settings.palette;
document.documentElement.classList.toggle("dark", settings.theme === "dark");
startApplication(document, App, (component, options) => mount(component, { ...options, props: { initialWorkflowDefaults: settings.workflowDefaults } }));
