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
    const exception = new Error('Database connection failed');
    filter.catch(exception, mockHost);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      statusCode: 500,
      message: 'Database connection failed',
    }));
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
});
