import { app } from '../server/app';
import { registerRoutes } from '../server/routes';

let initialized = false;

async function init() {
  if (!initialized) {
    await registerRoutes(app);
    initialized = true;
  }
}

export default async function handler(req: any, res: any) {
  await init();
  app(req, res);
}
