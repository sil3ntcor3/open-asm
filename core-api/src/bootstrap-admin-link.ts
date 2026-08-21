import 'dotenv/config';
import { createBootstrapAuthorizationUrl } from './modules/root/bootstrap-authorization';

try {
  process.stdout.write(
    `${createBootstrapAuthorizationUrl(
      process.env.OASM_CONSOLE_URL,
      process.env.ADMIN_BOOTSTRAP_TOKEN,
    )}\n`,
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unable to create setup link';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
