// Serverska funkcija za blog: čita i objavljuje postove preko GitHub API-ja.
// Tajne (GITHUB_TOKEN, BLOG_ADMIN_PASSWORD) žive u Vercel env varijablama.

const REPO = process.env.GITHUB_REPO || 'Web-studio-55/petrapavlek';
const TOKEN = process.env.GITHUB_TOKEN;
const PASS = process.env.BLOG_ADMIN_PASSWORD;

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'petrapavlek-blog',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  }
  return res;
}

async function getFile(path) {
  const res = await gh(`contents/${encodeURI(path)}?ref=main`);
  if (res.status === 404) return null;
  return res.json();
}

async function putFile(path, contentB64, message, sha) {
  const body = { message, content: contentB64, branch: 'main' };
  if (sha) body.sha = sha;
  await gh(`contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) });
}

function decode(file) {
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}
function encode(obj) {
  return Buffer.from(JSON.stringify(obj, null, 2)).toString('base64');
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const slug = (req.query && req.query.slug) || '';
      const path = slug ? `posts/${slug.replace(/[^a-z0-9-]/g, '')}.json` : 'posts/index.json';
      const f = await getFile(path);
      res.setHeader('Cache-Control', 'no-store');
      if (!f) return res.status(404).json({ error: 'not-found' });
      return res.status(200).json(decode(f));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

    const body = req.body || {};
    if (!PASS || !TOKEN || body.password !== PASS) {
      return res.status(401).json({ error: 'wrong-password' });
    }

    if (body.action === 'login') return res.status(200).json({ ok: true });

    if (body.action === 'publish') {
      let { slug, title, excerpt, html, cover, date } = body;
      slug = String(slug || '').replace(/[^a-z0-9-]/g, '');
      if (!slug || !title || !html) return res.status(400).json({ error: 'missing-fields' });

      let imgN = 0;
      const commitDataUri = async (dataUri) => {
        const m = dataUri.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
        if (!m) return dataUri;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const p = `img/blog/${slug}-${Date.now()}-${imgN++}.${ext}`;
        await putFile(p, m[2], `Blog slika: ${slug}`);
        return `img/blog/${p.split('/').pop()}`;
      };

      if (cover && cover.startsWith('data:')) cover = await commitDataUri(cover);
      const dataUris = [...html.matchAll(/src="(data:image\/[^"]+)"/g)].map((m) => m[1]);
      for (const u of dataUris) {
        const p = await commitDataUri(u);
        html = html.replace(u, p);
      }

      const post = {
        slug, title,
        excerpt: excerpt || '',
        cover: cover || '',
        html,
        date: date || new Date().toISOString().slice(0, 10),
      };
      const existing = await getFile(`posts/${slug}.json`);
      await putFile(`posts/${slug}.json`, encode(post), `Blog: ${title}`, existing ? existing.sha : undefined);

      const idxFile = await getFile('posts/index.json');
      let idx = idxFile ? decode(idxFile) : [];
      idx = idx.filter((p) => p.slug !== slug);
      idx.unshift({ slug, title, excerpt: post.excerpt, cover: post.cover, date: post.date });
      await putFile('posts/index.json', encode(idx), `Blog index: ${title}`, idxFile ? idxFile.sha : undefined);

      return res.status(200).json({ ok: true, slug });
    }

    if (body.action === 'delete') {
      const slug = String(body.slug || '').replace(/[^a-z0-9-]/g, '');
      const f = await getFile(`posts/${slug}.json`);
      if (f) {
        await gh(`contents/posts/${slug}.json`, {
          method: 'DELETE',
          body: JSON.stringify({ message: `Blog: obriši ${slug}`, sha: f.sha, branch: 'main' }),
        });
      }
      const idxFile = await getFile('posts/index.json');
      if (idxFile) {
        const idx = decode(idxFile).filter((p) => p.slug !== slug);
        await putFile('posts/index.json', encode(idx), `Blog index: obriši ${slug}`, idxFile.sha);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown-action' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
