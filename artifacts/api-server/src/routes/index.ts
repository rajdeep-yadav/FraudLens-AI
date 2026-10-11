import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fraudlensRouter from "./fraudlens";
import { authRequired } from "../middlewares/auth";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
router.use(authRequired);
router.use(fraudlensRouter);

export default router;
