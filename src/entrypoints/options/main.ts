import { createApp } from "vue";
import { applyGitLabTheme } from "@/components/theme";
import App from "./App.vue";
import "./style.css";

applyGitLabTheme();
createApp(App).mount("#app");
