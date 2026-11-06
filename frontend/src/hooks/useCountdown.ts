import { useInterval } from "@mantine/hooks";
import { useEffect, useState } from "react";

export const getReturnValue = (countDown: number) => {
	countDown = Math.max(0, countDown);
	const days = Math.floor(countDown / (1000 * 60 * 60 * 24));
	const hours = Math.floor(
		(countDown % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
	);
	const minutes = Math.floor((countDown % (1000 * 60 * 60)) / (1000 * 60));
	const seconds = Math.floor((countDown % (1000 * 60)) / 1000);

	return {
		totalMilliseconds: countDown,
		days: days < 10 ? `0${days}` : days,
		hours: hours < 10 ? `0${hours}` : hours,
		minutes: minutes < 10 ? `0${minutes}` : minutes,
		seconds: seconds < 10 ? `0${seconds}` : seconds,
	};
};

export const useCountdown = (date: Date | number | string) => {
	const countDownDate = new Date(date).getTime();
	const [countDown, setCountDown] = useState<number>(
		countDownDate - Date.now(),
	);

	const interval = useInterval(
		() => setCountDown(countDownDate - Date.now()),
		1000,
	);

	useEffect(() => {
		interval.start();
		return () => interval.stop();
	}, [interval]);

	return getReturnValue(countDown);
};
