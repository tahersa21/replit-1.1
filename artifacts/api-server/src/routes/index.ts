import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import uploadRouter from "./upload";
import builderRouter from "./builder";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(uploadRouter);
router.use(builderRouter);

export default router;
