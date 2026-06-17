import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { UPLOAD_ROOT, PUBLIC_PREFIX } from './services/storage.ts';
import imageRoutes from './routes/images.ts';
import annotationRoutes from './routes/annotations.ts';
import sessionRoutes from './routes/sessions.ts';
import './db/index.ts';

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024, files: 200 }, // up to 200 images/request
});
await app.register(fastifyStatic, {
  root: UPLOAD_ROOT,
  prefix: `${PUBLIC_PREFIX}/`,
  // immutable, content-hashed assets -> cache hard
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
});

await app.register(sessionRoutes);
await app.register(imageRoutes);
await app.register(annotationRoutes);

app.get('/api/health', async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`api on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
