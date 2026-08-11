import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/grid.css";
import "./styles/reveal.css";
import "./styles/search.css";
import "./styles/shell.css";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<StrictMode><App /></StrictMode>);
