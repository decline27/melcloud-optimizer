// Mock implementation of node-fetch
const fetch = jest.fn();

// Mock Response class
class Response {
  ok: boolean;
  status: number;
  statusText: string;
  private _body: any;

  constructor(body: any, options: any = {}) {
    this.ok = options.status ? options.status >= 200 && options.status < 300 : true;
    this.status = options.status || 200;
    this.statusText = options.statusText || '';
    this._body = body;
  }

  json() {
    return Promise.resolve(this._body);
  }

  text() {
    return Promise.resolve(typeof this._body === 'string' ? this._body : JSON.stringify(this._body));
  }
}

// Mock Headers class
class Headers {
  private _headers: Record<string, string> = {};

  constructor(init?: Record<string, string> | Headers) {
    if (init) {
      if (init instanceof Headers) {
        // Copy headers
        Object.assign(this._headers, (init as any)._headers);
      } else {
        // Copy from object
        Object.assign(this._headers, init);
      }
    }
  }

  append(name: string, value: string): void {
    this._headers[name.toLowerCase()] = value;
  }

  delete(name: string): void {
    delete this._headers[name.toLowerCase()];
  }

  get(name: string): string | null {
    return this._headers[name.toLowerCase()] || null;
  }

  has(name: string): boolean {
    return name.toLowerCase() in this._headers;
  }

  set(name: string, value: string): void {
    this._headers[name.toLowerCase()] = value;
  }

  forEach(callback: (value: string, name: string) => void): void {
    Object.entries(this._headers).forEach(([name, value]) => callback(value, name));
  }
}

// Mock Request class
class Request {
  url: string;
  method: string;
  headers: Headers;
  body: any;

  constructor(input: string | Request, init: any = {}) {
    if (input instanceof Request) {
      this.url = input.url;
      this.method = input.method;
      this.headers = new Headers(input.headers);
      this.body = input.body;
    } else {
      this.url = input;
      this.method = init.method || 'GET';
      this.headers = new Headers(init.headers);
      this.body = init.body;
    }
  }
}

// Export the mock implementations
export { Response, Headers, Request };
export default fetch;
