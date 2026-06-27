const app = require("../api/index.js");
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`MoonPay sandbox backend running on http://localhost:${PORT}`);
  console.log(`  Running locally with proxy mappings enabled.`);
});
