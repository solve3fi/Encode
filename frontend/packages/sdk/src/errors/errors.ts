export enum MathErrorCode {
  MultiplicationOverflow = `MultiplicationOverflow`,
  MulDivOverflow = `MulDivOverflow`,
  MultiplicationShiftRightOverflow = `MultiplicationShiftRightOverflow`,
  DivideByZero = `DivideByZero`,
}

export enum TokenErrorCode {
  TokenMaxExceeded = `TokenMaxExceeded`,
  TokenMinSubceeded = `TokenMinSubceeded`,
}

export enum SwapErrorCode {
  InvalidDevFeePercentage = `InvalidDevFeePercentage`,
  InvalidSqrtPriceLimitDirection = `InvalidSqrtPriceLimitDirection`,
  SqrtPriceOutOfBounds = `SqrtPriceOutOfBounds`,
  ZeroTradableAmount = `ZeroTradableAmount`,
  AmountOutBelowMinimum = `AmountOutBelowMinimum`,
  AmountInAboveMaximum = `AmountInAboveMaximum`,
  TickArrayCrossingAboveMax = `TickArrayCrossingAboveMax`,
  TickArrayIndexNotInitialized = `TickArrayIndexNotInitialized`,
  TickArraySequenceInvalid = `TickArraySequenceInvalid`,
  AmountRemainingOverflow = `AmountRemainingOverflow`,
  AmountCalcOverflow = `AmountCalcOverflow`,
}

export enum RouteQueryErrorCode {
  RouteDoesNotExist = "RouteDoesNotExist",
  TradeAmountTooHigh = "TradeAmountTooHigh",
  ZeroInputAmount = "ZeroInputAmount",
  General = "General",
}

export type SolvesErrorCode =
  | TokenErrorCode
  | SwapErrorCode
  | MathErrorCode
  | RouteQueryErrorCode;

export class SolvesError extends Error {
  message: string;
  errorCode?: SolvesErrorCode;
  constructor(
    message: string,
    errorCode?: SolvesErrorCode,
    stack?: string,
  ) {
    super(message);
    this.message = message;
    this.errorCode = errorCode;
    this.stack = stack;
  }

  public static isSolvesErrorCode(
    e: unknown,
    code: SolvesErrorCode,
  ): boolean {
    return e instanceof SolvesError && e.errorCode === code;
  }
}
