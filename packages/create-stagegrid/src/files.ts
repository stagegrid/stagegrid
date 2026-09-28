import { randomBytes } from 'node:crypto'

export interface ScaffoldOptions {
  name: string
  coreVersion: string
  db: 'docker' | 'url'
  databaseUrl?: string
}

const DOCKER_DB_URL = 'postgres://stagegrid:stagegrid@localhost:5432/stagegrid'

/** Every file create-stagegrid writes, keyed by relative path. Pure so it can be tested. */
export function scaffoldFiles(opts: ScaffoldOptions): Record<string, string> {
  const databaseUrl = opts.db === 'docker' ? DOCKER_DB_URL : (opts.databaseUrl ?? '')
  const secret = randomBytes(48).toString('base64url')
  const pkg = {
    name: opts.name,
    private: true,
    type: 'module',
    scripts: { dev: 'stagegrid dev', start: 'stagegrid start', migrate: 'stagegrid migrate' },
    dependencies: { '@stagegrid/core': `^${opts.coreVersion}` },
    engines: { node: '>=22' },
  }
  return {
    'package.json': `${JSON.stringify(pkg, null, 2)}\n`,
    '.env': `DATABASE_URL=${databaseUrl}\nAPP_URL=http://localhost:4000\nAPP_SECRET=${secret}\n`,
    '.env.example': 'DATABASE_URL=\nAPP_URL=\nAPP_SECRET=\n',
    '.gitignore': 'node_modules\n.env\n',
    'docker-compose.yml': `services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: stagegrid
      POSTGRES_PASSWORD: stagegrid
      POSTGRES_DB: stagegrid
    ports:
      - '5432:5432'
    volumes:
      - db-data:/var/lib/postgresql/data
  app:
    profiles: ['app']
    build: .
    env_file: .env
    environment:
      DATABASE_URL: postgres://stagegrid:stagegrid@db:5432/stagegrid
    ports:
      - '4000:4000'
    depends_on:
      - db
volumes:
  db-data:
`,
    Dockerfile: `FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "stagegrid", "start"]
`,
    'README.md': `# ${opts.name}

A [Stagegrid](https://github.com/stagegrid/stagegrid) instance.

## Run locally

\`\`\`bash
${opts.db === 'docker' ? 'docker compose up -d db\n' : ''}npm run dev
\`\`\`

Open http://localhost:4000/setup to create the first admin.

## Run in production

Set \`APP_URL\` to the public URL (https) and keep \`APP_SECRET\` secret, then:

\`\`\`bash
npm start
\`\`\`

or \`docker compose --profile app up -d\`.

## Update

\`\`\`bash
npm update @stagegrid/core
\`\`\`

Migrations run automatically on start.
`,
  }
}
