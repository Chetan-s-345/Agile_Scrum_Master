const fs = require("fs");
const path = require("path");

async function patchExecutableIcon(context) {
  const { rcedit } = await import("rcedit");
  const iconPath = path.join(__dirname, "..", "electron", "assets", "sprint.ico");
  const executableName = `${context.packager.appInfo.productFilename}.exe`;
  const executablePath = path.join(context.appOutDir, executableName);

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Icon file not found: ${iconPath}`);
  }

  if (!fs.existsSync(executablePath)) {
    throw new Error(`Executable not found: ${executablePath}`);
  }

  await rcedit(executablePath, {
    icon: iconPath,
  });

  console.log(`[afterPack] Patched icon for ${executablePath}`);
}

module.exports = patchExecutableIcon;