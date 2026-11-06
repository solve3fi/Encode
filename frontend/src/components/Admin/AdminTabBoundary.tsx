"use client";

import { Alert, Button, Stack, Text } from "@mantine/core";
import { Component, type PropsWithChildren } from "react";

type State = { error: Error | null };

/**
 * Contains a render error to one admin tab instead of blanking the whole app
 * (the root boundary blames the wallet connector for every render error), and
 * shows the real message so it can be reported.
 */
export class AdminTabBoundary extends Component<PropsWithChildren<{ name: string }>, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: unknown) {
		console.error("Admin tab crashed:", error);
	}

	render() {
		if (!this.state.error) return this.props.children;
		return (
			<Alert color="red" title={`${this.props.name} failed to render`}>
				<Stack gap="xs">
					<Text size="sm" ff="monospace" style={{ overflowWrap: "anywhere" }}>
						{this.state.error.message}
					</Text>
					<Button size="xs" variant="light" w="fit-content" onClick={() => this.setState({ error: null })}>
						Retry
					</Button>
				</Stack>
			</Alert>
		);
	}
}
