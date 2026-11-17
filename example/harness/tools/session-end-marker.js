// Fake SessionEnd hook for the setup example: drops a marker file so a later close step can log the session.
const fs = require("fs");
fs.mkdirSync("tools/markers", { recursive: true });
fs.writeFileSync(`tools/markers/${Date.now()}.ended`, "");
