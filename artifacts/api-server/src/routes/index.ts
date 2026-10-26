import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import licensingRouter from "./licensing";
import printShopRouter from "./print-shop";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(licensingRouter);
router.use(printShopRouter);

export default router;
