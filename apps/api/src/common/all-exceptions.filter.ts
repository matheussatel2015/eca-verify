import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Global exception filter.
 *
 * - For HttpException: returns the original status and a safe message/body.
 * - For everything else: returns a generic 500 and logs the real error
 *   server-side. This prevents leaking stack traces, DB errors, or
 *   upstream (CAF) details to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    // Unknown/unexpected error: log full detail server-side, return generic body.
    console.error('[unhandled-exception]', exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
