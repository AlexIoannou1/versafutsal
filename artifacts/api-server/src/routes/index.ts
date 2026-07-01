import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import venuesRouter from "./venues";
import adminRouter from "./admin";
import bookingsRouter from "./bookings";
import paymentsRouter from "./payments";
import favouritesRouter from "./favourites";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(venuesRouter);
router.use(adminRouter);
router.use(bookingsRouter);
router.use(paymentsRouter);
router.use(favouritesRouter);

export default router;
