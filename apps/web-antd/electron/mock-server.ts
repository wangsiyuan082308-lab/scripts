/**
 * Electron 内嵌 Mock API 服务器
 *
 * 在 Electron 生产模式下启动一个本地 HTTP 服务器，
 * 模拟后端认证相关的 API，让客户端可以正常登录和使用。
 */
import http from 'node:http';

const MOCK_USER = {
  id: 0,
  realName: 'Admin',
  roles: ['super'],
  username: 'vben',
  homePath: '/dashboard',
};

const MOCK_ACCESS_TOKEN = 'electron-mock-access-token';

const MOCK_CODES = ['AC_100100', 'AC_100110', 'AC_100120', 'AC_100010'];

const MOCK_MENUS = [
  {
    meta: {
      order: -1,
      title: 'page.dashboard.title',
    },
    name: 'Dashboard',
    path: '/dashboard',
    redirect: '/dashboard/workspace',
    children: [
      {
        name: 'Workspace',
        path: '/dashboard/workspace',
        component: '/dashboard/workspace/index',
        meta: {
          affixTab: true,
          icon: 'carbon:workspace',
          title: 'page.dashboard.workspace',
        },
      },
    ],
  },
];

function success(data: any) {
  return JSON.stringify({ code: 0, data, message: 'ok' });
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

export function startMockServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );

      // 处理 CORS 预检请求
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url?.split('?')[0] || '';

      // POST /api/auth/login
      if (url === '/api/auth/login' && req.method === 'POST') {
        await parseBody(req);
        // 无论什么用户名密码都允许登录
        res.writeHead(200);
        res.end(success({ ...MOCK_USER, accessToken: MOCK_ACCESS_TOKEN }));
        return;
      }

      // GET /api/user/info
      if (url === '/api/user/info') {
        res.writeHead(200);
        res.end(success(MOCK_USER));
        return;
      }

      // GET /api/auth/codes
      if (url === '/api/auth/codes') {
        res.writeHead(200);
        res.end(success(MOCK_CODES));
        return;
      }

      // GET /api/menu/all
      if (url === '/api/menu/all') {
        res.writeHead(200);
        res.end(success(MOCK_MENUS));
        return;
      }

      // POST /api/auth/logout
      if (url === '/api/auth/logout') {
        res.writeHead(200);
        res.end(success(null));
        return;
      }

      // POST /api/auth/refresh
      if (url === '/api/auth/refresh') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            data: MOCK_ACCESS_TOKEN,
            status: 0,
          }),
        );
        return;
      }

      // 其他路由返回 404
      res.writeHead(404);
      res.end(JSON.stringify({ code: 404, message: 'Not Found' }));
    });

    // 使用随机端口
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        console.log(`[Mock Server] 已启动: http://127.0.0.1:${addr.port}`);
        resolve(addr.port);
      } else {
        reject(new Error('Failed to start mock server'));
      }
    });

    server.on('error', reject);
  });
}
