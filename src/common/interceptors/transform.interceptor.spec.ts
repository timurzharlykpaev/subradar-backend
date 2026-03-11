import { TransformInterceptor } from './transform.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('TransformInterceptor', () => {
  let interceptor: TransformInterceptor<any>;

  beforeEach(() => {
    interceptor = new TransformInterceptor();
  });

  it('should be defined', () => expect(interceptor).toBeDefined());

  it('wraps data with success and timestamp', (done) => {
    const context = {} as ExecutionContext;
    const callHandler: CallHandler = {
      handle: () => of({ id: '1', name: 'test' }),
    };

    interceptor.intercept(context, callHandler).subscribe((result) => {
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: '1', name: 'test' });
      expect(typeof result.timestamp).toBe('string');
      done();
    });
  });

  it('wraps null data', (done) => {
    const context = {} as ExecutionContext;
    const callHandler: CallHandler = {
      handle: () => of(null),
    };

    interceptor.intercept(context, callHandler).subscribe((result) => {
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      done();
    });
  });

  it('wraps array data', (done) => {
    const context = {} as ExecutionContext;
    const callHandler: CallHandler = {
      handle: () => of([1, 2, 3]),
    };

    interceptor.intercept(context, callHandler).subscribe((result) => {
      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
      done();
    });
  });
});
