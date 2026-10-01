import { mount } from "svelte";
import App from "./App.svelte";
import { startApplication } from "./bootstrap.ts";

startApplication(document, App, mount);
