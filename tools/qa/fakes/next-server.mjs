// Stand-in for next/server in tools/qa/check-parity.mjs: enough of NextResponse for the routes.
export class NextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = init.headers ?? {};
    this.jsonBody = undefined;
  }
  static json(body, init = {}) {
    const r = new NextResponse(null, init);
    r.jsonBody = body;
    return r;
  }
}
export class NextRequest {}
