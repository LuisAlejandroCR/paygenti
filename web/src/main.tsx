// web/src/main.tsx: web app entry — mounts the root component into #app.
import { render } from "preact";

function App() {
  return <main>paygent</main>;
}

const root = document.getElementById("app");
if (root) render(<App />, root);
