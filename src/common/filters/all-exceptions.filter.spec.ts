import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = { method: 'GET', url: '/test' };
    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as any;
  });

  it('should be defined', () => expect(filter).toBeDefined());

  it('handles HttpException with string response', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      statusCode: 404,
    }));
  });

  it('handles HttpException with object response', () => {
    const exception = new HttpException({ message: 'Validation failed', error: 'Bad Request' }, HttpStatus.BAD_REQUEST);
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      statusCode: 400,
      message: 'Validation failed',
    }));
  });

  it('handles non-HttpException with 500 status', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const exception = new Error('Database connection failed');
      filter.catch(exception, mockHost);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        statusCode: 500,
        message: 'Database connection failed',
      }));
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('handles unknown exception without message', () => {
    filter.catch('unknown error string', mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      statusCode: 500,
    }));
  });

  it('includes path in response', () => {
    const exception = new HttpException('Unauthorized', 401);
    filter.catch(exception, mockHost);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      path: '/test',
    }));
  });

  it('includes timestamp in response', () => {
    const exception = new HttpException('Error', 400);
    filter.catch(exception, mockHost);
    const call = mockResponse.json.mock.calls[0][0];
    expect(call).toHaveProperty('timestamp');
    expect(typeof call.timestamp).toBe('string');
  });

  describe('redactSecrets — response body', () => {
    const SECRET_VALUES = {
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456',
      magicLinkToken:
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6abcd',
      otp: '987654',
    };

    it.each([
      ['?token=', `?token=${SECRET_VALUES.magicLinkToken}`],
      ['?code=', `?code=${SECRET_VALUES.otp}`],
      ['?id_token=', `?id_token=${SECRET_VALUES.jwt}`],
      ['?refresh_token=', `?refresh_token=${SECRET_VALUES.jwt}`],
      ['?sig=', `?sig=abcdef0123456789`],
      ['?session=', `?session=session-cookie-value`],
    ])('redacts %s from response body.path', (label, qs) => {
      mockRequest.url = `/auth/verify${qs}`;
      const exception = new HttpException('Bad', 400);
      filter.catch(exception, mockHost);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.path).toContain(label);
      expect(body.path).toContain('REDACTED');
      expect(body.path).not.toContain(qs.split('=')[1]);
    });

    it('redacts JWT-shaped strings inside the URL path', () => {
      mockRequest.url = `/some/path/${SECRET_VALUES.jwt}/more`;
      filter.catch(new HttpException('Bad', 400), mockHost);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.path).not.toContain(SECRET_VALUES.jwt);
      expect(body.path).toContain('REDACTED_JWT');
    });

    it('strips CRLF for log injection defence (V7.1.4)', () => {
      mockRequest.url = '/test\r\n[FAKE] forged log line';
      filter.catch(new HttpException('Bad', 400), mockHost);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.path).not.toMatch(/\r\n/);
    });

    it('redacts secrets in body.stack in non-prod', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const err = new Error('boom');
        err.stack = `Error: token=${SECRET_VALUES.jwt}\n  at /test`;
        filter.catch(err, mockHost);
        const body = mockResponse.json.mock.calls[0][0];
        expect(body.stack).not.toContain(SECRET_VALUES.jwt);
        expect(body.stack).toContain('REDACTED');
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    it('does not expose body.stack in production', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const err = new Error('boom');
        err.stack = 'Error: secret-stuff\n  at /test';
        filter.catch(err, mockHost);
        const body = mockResponse.json.mock.calls[0][0];
        expect(body.stack).toBeUndefined();
      } finally {
        process.env.NODE_ENV = prev;
      }
    });
  });
});
