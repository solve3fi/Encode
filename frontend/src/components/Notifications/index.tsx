import type { NotificationData } from "@mantine/notifications";
import {
	Notifications as NotificationProvider,
	notifications,
} from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";

import classes from "./Notification.module.css";

const error = (props: NotificationData) =>
	notifications.show({
		...props,
		color: "red",
		icon: <IconX />,
		classNames: classes,
	});

const success = (props: NotificationData) =>
	notifications.show({
		...props,
		color: "green",
		icon: <IconCheck />,
		classNames: classes,
	});

export const info = (props: NotificationData) =>
	notifications.show({
		...props,
		color: "blue",
		icon: <IconCheck />,
		classNames: classes,
	});

export const warning = (props: NotificationData) =>
	notifications.show({
		...props,
		color: "yellow",
		icon: <IconCheck />,
		classNames: classes,
	});

export const notification = {
	error,
	success,
	info,
	warning,
	...notifications,
};

const Notifications: React.FC = () => (
	<NotificationProvider containerWidth={360} position="top-center" />
);
export default Notifications;
