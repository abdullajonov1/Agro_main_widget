import { React, getAppStore, Immutable } from "jimu-core";
import type { AllWidgetSettingProps } from "jimu-for-builder";
import { Button } from "jimu-ui";
import { loadArcGISJSAPIModules } from "jimu-arcgis";
import { type IMConfig } from "../config";
import { buildAccessRuleWhere } from "../shared/agri-access-config";
import "./agri-access-setting.css";

/** jimu-core re-exports seamless-immutable as a namespace; cast for callable use. */
const Imm = Immutable as unknown as <T>(value: T) => any;

type RuleOperator = "equal" | "range" | "include" | "like";

type AccessRule = {
    id: string;
    operator: RuleOperator;
    value?: string;
    from?: string;
    to?: string;
    values?: string[];
    groups: string[];
};

type AccessFieldRule = {
    id: string;
    title: string;
    field: string;
    rules: AccessRule[];
};

type AccessConfig = {
    fullAccessGroups: string[];
    rules: AccessFieldRule[];
};

type PortalGroupInfo = {
    id: string;
    title: string;
    usersCount: number | null;
    isUnavailable?: boolean;
};

type EsriRequestFunction = (
    url: string,
    options?: {
        query?: Record<string, string | number>;
        responseType?: string;
    }
) => Promise<{ data: any }>;

type DialogState =
    | null
    | {
        type:
        | "addField"
        | "editField"
        | "deleteField"
        | "addRule"
        | "editRule"
        | "deleteRule"
        | "addGroup"
        | "editGroup"
        | "deleteGroup"
        | "addGlobalGroup"
        | "editGlobalGroup"
        | "deleteGlobalGroup";
        payload?: any;
    };

const GLOBAL_ACCESS_ID = "__global_access__";

const makeId = (): string => {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const defaultConfig: AccessConfig = {
    fullAccessGroups: [],
    rules: [],
};

const normalizeOperator = (operator: any): RuleOperator => {
    if (operator === "equal") return "equal";
    if (operator === "range") return "range";
    if (operator === "include") return "include";
    if (operator === "like") return "like";

    if (operator === "eq") return "equal";
    if (operator === "between") return "range";
    if (operator === "in") return "include";

    return "equal";
};

const normalizeLoadedConfig = (data: any): AccessConfig => {
    return {
        fullAccessGroups: Array.isArray(data?.fullAccessGroups)
            ? data.fullAccessGroups.map((item: any) => String(item))
            : [],
        rules: Array.isArray(data?.rules)
            ? data.rules.map((fieldItem: any) => ({
                id: fieldItem.id || makeId(),
                title: fieldItem.title || "",
                field: fieldItem.field || "",
                rules: Array.isArray(fieldItem.rules)
                    ? fieldItem.rules.map((rule: any) => ({
                        id: rule.id || makeId(),
                        operator: normalizeOperator(rule.operator),
                        value: rule.value,
                        from: rule.from,
                        to: rule.to,
                        values: Array.isArray(rule.values)
                            ? rule.values.map((item: any) => String(item))
                            : [],
                        groups: Array.isArray(rule.groups)
                            ? rule.groups.map((item: any) => String(item))
                            : [],
                    }))
                    : [],
            }))
            : [],
    };
};

const cloneAccessConfig = (data: AccessConfig): AccessConfig => {
    return normalizeLoadedConfig(JSON.parse(JSON.stringify(data)));
};

const getInitialAccessConfig = (widgetConfig: any): AccessConfig => {
    const storedConfig = widgetConfig?.accessConfig;

    if (!storedConfig) {
        return cloneAccessConfig(defaultConfig);
    }

    const plainConfig =
        typeof storedConfig.asMutable === "function"
            ? storedConfig.asMutable({ deep: true })
            : storedConfig;

    return normalizeLoadedConfig(plainConfig);
};

const getConfigGroupIds = (config: AccessConfig): string[] => {
    const groupIds = [
        ...config.fullAccessGroups,
        ...config.rules.flatMap((field) =>
            field.rules.flatMap((rule) => rule.groups)
        ),
    ];

    return Array.from(new Set(groupIds)).sort();
};

const getPortalGroupInfo = async (
    esriRequest: EsriRequestFunction,
    portalUrl: string,
    groupId: string
): Promise<PortalGroupInfo> => {
    const encodedGroupId = encodeURIComponent(groupId);
    const groupUrl =
        `${portalUrl}/sharing/rest/community/groups/${encodedGroupId}`;

    try {
        const groupResponse = await esriRequest(groupUrl, {
            query: { f: "json" },
            responseType: "json",
        });

        if (groupResponse.data?.error) {
            throw new Error(groupResponse.data.error.message || "Группа недоступна");
        }

        let usersCount: number | null = null;

        try {
            const usersResponse = await esriRequest(`${groupUrl}/userList`, {
                query: {
                    f: "json",
                    start: 1,
                    num: 1,
                },
                responseType: "json",
            });

            if (
                !usersResponse.data?.error &&
                typeof usersResponse.data?.total === "number"
            ) {
                /*
                 * userList возвращает owner отдельно от массива users.
                 * Поэтому добавляем владельца к количеству остальных пользователей.
                 */
                usersCount =
                    usersResponse.data.total
                // + (usersResponse.data.owner?.username ? 1 : 0);
            }
        } catch {
            usersCount = null;
        }

        return {
            id: groupId,
            title: groupResponse.data?.title || "Без названия",
            usersCount,
        };
    } catch {
        return {
            id: groupId,
            title: "Название недоступно",
            usersCount: null,
            isUnavailable: true,
        };
    }
};

export default function AgriAccessSettingPanel(
    props: AllWidgetSettingProps<IMConfig>,
) {
    const [showModal, setShowModal] = React.useState<boolean>(false);
    const [config, setConfig] = React.useState<AccessConfig>(() =>
        getInitialAccessConfig(props.config)
    );
    const [savedConfig, setSavedConfig] = React.useState<AccessConfig>(() =>
        getInitialAccessConfig(props.config)
    );
    const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState<boolean>(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    const noticeTimer = React.useRef<number | null>(null);

    const showNotice = (message: string): void => {
        if (noticeTimer.current !== null) {
            window.clearTimeout(noticeTimer.current);
        }

        setNotice(message);
        noticeTimer.current = window.setTimeout(() => {
            setNotice(null);
            noticeTimer.current = null;
        }, 1800);
    };

    React.useEffect(() => {
        return () => {
            if (noticeTimer.current !== null) {
                window.clearTimeout(noticeTimer.current);
            }
        };
    }, []);

    React.useEffect(() => {
        const next = getInitialAccessConfig(props.config);
        setConfig(next);
        setSavedConfig(next);
        setHasUnsavedChanges(false);
    }, [props.config?.accessConfig]);

    const setDraftConfig = (
        update: (previous: AccessConfig) => AccessConfig
    ): void => {
        setConfig((previous) => update(previous));
        setHasUnsavedChanges(true);
    };
    const [groupsInfo, setGroupsInfo] = React.useState<Record<string, PortalGroupInfo>>({});
    const [groupsLoading, setGroupsLoading] = React.useState<boolean>(false);

    const groupIdsSignature = getConfigGroupIds(config).join("|");

    React.useEffect(() => {
        let isCancelled = false;

        const loadGroupsInfo = async (): Promise<void> => {
            const groupIds = getConfigGroupIds(config);

            if (groupIds.length === 0) {
                setGroupsInfo({});
                return;
            }

            const portalUrl = getAppStore().getState()?.portalUrl;

            if (!portalUrl) {
                return;
            }

            setGroupsLoading(true);

            try {
                const [esriRequest] = await loadArcGISJSAPIModules([
                    "esri/request",
                ]) as [EsriRequestFunction];

                const result = await Promise.all(
                    groupIds.map((groupId) =>
                        getPortalGroupInfo(esriRequest, portalUrl, groupId)
                    )
                );

                if (!isCancelled) {
                    const mapped = result.reduce<Record<string, PortalGroupInfo>>(
                        (value, item) => {
                            value[item.id] = item;
                            return value;
                        },
                        {}
                    );

                    setGroupsInfo(mapped);
                }
            } finally {
                if (!isCancelled) {
                    setGroupsLoading(false);
                }
            }
        };

        void loadGroupsInfo();

        return () => {
            isCancelled = true;
        };
    }, [groupIdsSignature]);

    const [selectedId, setSelectedId] = React.useState<string>(GLOBAL_ACCESS_ID);
    const [dialog, setDialog] = React.useState<DialogState>(null);

    const [selectedRuleIds, setSelectedRuleIds] = React.useState<string[]>([]);
    const [selectedGroupKeys, setSelectedGroupKeys] = React.useState<string[]>([]);

    const [formTitle, setFormTitle] = React.useState<string>("");
    const [formField, setFormField] = React.useState<string>("");
    const [formGroup, setFormGroup] = React.useState<string>("");

    const [ruleOperator, setRuleOperator] = React.useState<RuleOperator>("equal");
    const [ruleValue, setRuleValue] = React.useState<string>("");
    const [ruleFrom, setRuleFrom] = React.useState<string>("");
    const [ruleTo, setRuleTo] = React.useState<string>("");
    const [ruleValues, setRuleValues] = React.useState<string[]>([]);
    const [newListValue, setNewListValue] = React.useState<string>("");

    const selectedField =
        selectedId === GLOBAL_ACCESS_ID
            ? null
            : config.rules.find((item) => item.id === selectedId) ?? null;

    const renderGroupIdentity = (groupId: string) => {
        const groupInfo = groupsInfo[groupId];

        return (
            <div className="groupIdentity">
                <div className="groupName">
                    {groupsLoading ? (
                        <span className="groupNameLoading" aria-busy="true" aria-live="polite">
                            Загрузка…
                        </span>
                    ) : (
                        groupInfo?.title ?? "Название недоступно"
                    )}
                </div>

                <button
                    type="button"
                    className="groupIdCopyButton"
                    title="Скопировать ID"
                    onClick={(event) => {
                        event.stopPropagation();
                        void copyGroupId(groupId);
                    }}
                >
                    {groupId}
                </button>

                {groupInfo?.usersCount !== null && groupInfo?.usersCount !== undefined && (
                    <div className="groupMembers">
                        Пользователей: {groupInfo.usersCount}
                    </div>
                )}
            </div>
        );
    };

    const resetSelection = () => {
        setSelectedRuleIds([]);
        setSelectedGroupKeys([]);
    };

    const selectLeftItem = (id: string) => {
        setSelectedId(id);
        resetSelection();
    };

    const resetRuleForm = () => {
        setRuleOperator("equal");
        setRuleValue("");
        setRuleFrom("");
        setRuleTo("");
        setRuleValues([]);
        setNewListValue("");
    };

    const getRuleFromForm = (): AccessRule | null => {
        if (ruleOperator === "equal") {
            if (!ruleValue.trim()) return null;

            return {
                id: makeId(),
                operator: "equal",
                value: ruleValue.trim(),
                groups: [],
            };
        }

        if (ruleOperator === "range") {
            if (!ruleFrom.trim() || !ruleTo.trim()) return null;

            return {
                id: makeId(),
                operator: "range",
                from: ruleFrom.trim(),
                to: ruleTo.trim(),
                groups: [],
            };
        }

        if (ruleOperator === "include") {
            const cleanValues = ruleValues.map((item) => item.trim()).filter(Boolean);

            if (cleanValues.length === 0) return null;

            return {
                id: makeId(),
                operator: "include",
                values: cleanValues,
                groups: [],
            };
        }

        if (ruleOperator === "like") {
            if (!ruleValue.trim()) return null;

            return {
                id: makeId(),
                operator: "like",
                value: ruleValue.trim(),
                groups: [],
            };
        }

        return null;
    };

    const fillRuleForm = (rule: AccessRule) => {
        setRuleOperator(rule.operator);
        setRuleValue(rule.value ?? "");
        setRuleFrom(rule.from ?? "");
        setRuleTo(rule.to ?? "");
        setRuleValues(rule.values ?? []);
        setNewListValue("");
    };

    const openAddField = () => {
        setFormTitle("");
        setFormField("");
        resetRuleForm();
        setDialog({ type: "addField" });
    };

    const openEditField = () => {
        if (!selectedField) return;

        setFormTitle(selectedField.title);
        setFormField(selectedField.field);

        setDialog({
            type: "editField",
            payload: {
                fieldId: selectedField.id,
            },
        });
    };

    const saveField = () => {
        if (!formTitle.trim() || !formField.trim()) return;

        if (dialog?.type === "addField") {
            const firstRule = getRuleFromForm();

            const newField: AccessFieldRule = {
                id: makeId(),
                title: formTitle.trim(),
                field: formField.trim(),
                rules: firstRule ? [firstRule] : [],
            };

            setDraftConfig((prev) => ({
                ...prev,
                rules: [...prev.rules, newField],
            }));

            setSelectedId(newField.id);
            resetSelection();
        }

        if (dialog?.type === "editField") {
            setDraftConfig((prev) => ({
                ...prev,
                rules: prev.rules.map((item) =>
                    item.id === dialog.payload.fieldId
                        ? {
                            ...item,
                            title: formTitle.trim(),
                            field: formField.trim(),
                        }
                        : item
                ),
            }));
        }

        setDialog(null);
    };

    const deleteField = () => {
        if (!selectedField) return;

        setDraftConfig((prev) => {
            const nextRules = prev.rules.filter((item) => item.id !== selectedField.id);

            setSelectedId(nextRules[0]?.id ?? GLOBAL_ACCESS_ID);
            resetSelection();

            return {
                ...prev,
                rules: nextRules,
            };
        });

        setDialog(null);
    };

    const openAddRule = () => {
        resetRuleForm();
        setDialog({ type: "addRule" });
    };

    const openEditRule = (rule: AccessRule) => {
        fillRuleForm(rule);

        setDialog({
            type: "editRule",
            payload: {
                ruleId: rule.id,
            },
        });
    };

    const saveRule = () => {
        if (!selectedField) return;

        const formRule = getRuleFromForm();

        if (!formRule) {
            alert("Заполни значение правила");
            return;
        }

        if (dialog?.type === "addRule") {
            setDraftConfig((prev) => ({
                ...prev,
                rules: prev.rules.map((field) =>
                    field.id === selectedField.id
                        ? {
                            ...field,
                            rules: [...field.rules, formRule],
                        }
                        : field
                ),
            }));
        }

        if (dialog?.type === "editRule") {
            setDraftConfig((prev) => ({
                ...prev,
                rules: prev.rules.map((field) =>
                    field.id === selectedField.id
                        ? {
                            ...field,
                            rules: field.rules.map((rule) =>
                                rule.id === dialog.payload.ruleId
                                    ? {
                                        ...formRule,
                                        id: rule.id,
                                        groups: rule.groups,
                                    }
                                    : rule
                            ),
                        }
                        : field
                ),
            }));
        }

        setDialog(null);
    };

    const deleteRule = () => {
        if (!selectedField || !dialog?.payload?.ruleId) return;

        setDraftConfig((prev) => ({
            ...prev,
            rules: prev.rules.map((field) =>
                field.id === selectedField.id
                    ? {
                        ...field,
                        rules: field.rules.filter((rule) => rule.id !== dialog.payload.ruleId),
                    }
                    : field
            ),
        }));

        setSelectedRuleIds((prev) => prev.filter((id) => id !== dialog.payload.ruleId));
        setSelectedGroupKeys([]);

        setDialog(null);
    };

    const toggleRuleSelect = (ruleId: string) => {
        setSelectedRuleIds((prev) =>
            prev.includes(ruleId)
                ? prev.filter((id) => id !== ruleId)
                : [...prev, ruleId]
        );
    };

    const deleteSelectedRules = () => {
        if (!selectedField || selectedRuleIds.length === 0) return;

        setDraftConfig((prev) => ({
            ...prev,
            rules: prev.rules.map((field) =>
                field.id === selectedField.id
                    ? {
                        ...field,
                        rules: field.rules.filter((rule) => !selectedRuleIds.includes(rule.id)),
                    }
                    : field
            ),
        }));

        setSelectedRuleIds([]);
        setSelectedGroupKeys([]);
    };

    const makeGroupKey = (ruleId: string, index: number): string => {
        return `${ruleId}_${index}`;
    };

    const makeGlobalGroupKey = (index: number): string => {
        return `global_${index}`;
    };

    const toggleGroupSelect = (key: string) => {
        setSelectedGroupKeys((prev) =>
            prev.includes(key)
                ? prev.filter((item) => item !== key)
                : [...prev, key]
        );
    };

    const deleteSelectedGroups = () => {
        if (selectedGroupKeys.length === 0) return;

        if (selectedId === GLOBAL_ACCESS_ID) {
            setDraftConfig((prev) => ({
                ...prev,
                fullAccessGroups: prev.fullAccessGroups.filter(
                    (_, index) => !selectedGroupKeys.includes(makeGlobalGroupKey(index))
                ),
            }));
        }

        if (selectedField) {
            setDraftConfig((prev) => ({
                ...prev,
                rules: prev.rules.map((field) =>
                    field.id === selectedField.id
                        ? {
                            ...field,
                            rules: field.rules.map((rule) => ({
                                ...rule,
                                groups: rule.groups.filter(
                                    (_, index) =>
                                        !selectedGroupKeys.includes(makeGroupKey(rule.id, index))
                                ),
                            })),
                        }
                        : field
                ),
            }));
        }

        setSelectedGroupKeys([]);
    };

    const openAddGroup = (ruleId: string) => {
        setFormGroup("");

        setDialog({
            type: "addGroup",
            payload: {
                ruleId,
            },
        });
    };

    const openEditGroup = (ruleId: string, groupIndex: number, groupValue: string) => {
        setFormGroup(groupValue);

        setDialog({
            type: "editGroup",
            payload: {
                ruleId,
                groupIndex,
            },
        });
    };

    const saveGroup = () => {
        if (!selectedField || !formGroup.trim()) return;

        if (dialog?.type === "addGroup") {
            setDraftConfig((prev) => ({
                ...prev,
                rules: prev.rules.map((field) =>
                    field.id === selectedField.id
                        ? {
                            ...field,
                            rules: field.rules.map((rule) =>
                                rule.id === dialog.payload.ruleId
                                    ? {
                                        ...rule,
                                        groups: [...rule.groups, formGroup.trim()],
                                    }
                                    : rule
                            ),
                        }
                        : field
                ),
            }));
        }

        if (dialog?.type === "editGroup") {
            setDraftConfig((prev) => ({
                ...prev,
                rules: prev.rules.map((field) =>
                    field.id === selectedField.id
                        ? {
                            ...field,
                            rules: field.rules.map((rule) =>
                                rule.id === dialog.payload.ruleId
                                    ? {
                                        ...rule,
                                        groups: rule.groups.map((group, index) =>
                                            index === dialog.payload.groupIndex
                                                ? formGroup.trim()
                                                : group
                                        ),
                                    }
                                    : rule
                            ),
                        }
                        : field
                ),
            }));
        }

        setDialog(null);
    };

    const deleteGroup = () => {
        if (!selectedField || !dialog?.payload) return;

        setDraftConfig((prev) => ({
            ...prev,
            rules: prev.rules.map((field) =>
                field.id === selectedField.id
                    ? {
                        ...field,
                        rules: field.rules.map((rule) =>
                            rule.id === dialog.payload.ruleId
                                ? {
                                    ...rule,
                                    groups: rule.groups.filter(
                                        (_, index) => index !== dialog.payload.groupIndex
                                    ),
                                }
                                : rule
                        ),
                    }
                    : field
            ),
        }));

        setSelectedGroupKeys((prev) =>
            prev.filter(
                (key) => key !== makeGroupKey(dialog.payload.ruleId, dialog.payload.groupIndex)
            )
        );

        setDialog(null);
    };

    const openAddGlobalGroup = () => {
        setFormGroup("");
        setDialog({ type: "addGlobalGroup" });
    };

    const openEditGlobalGroup = (groupIndex: number, groupValue: string) => {
        setFormGroup(groupValue);

        setDialog({
            type: "editGlobalGroup",
            payload: {
                groupIndex,
            },
        });
    };

    const saveGlobalGroup = () => {
        if (!formGroup.trim()) return;

        if (dialog?.type === "addGlobalGroup") {
            setDraftConfig((prev) => ({
                ...prev,
                fullAccessGroups: [...prev.fullAccessGroups, formGroup.trim()],
            }));
        }

        if (dialog?.type === "editGlobalGroup") {
            setDraftConfig((prev) => ({
                ...prev,
                fullAccessGroups: prev.fullAccessGroups.map((group, index) =>
                    index === dialog.payload.groupIndex ? formGroup.trim() : group
                ),
            }));
        }

        setDialog(null);
    };

    const deleteGlobalGroup = () => {
        if (!dialog?.payload) return;

        setDraftConfig((prev) => ({
            ...prev,
            fullAccessGroups: prev.fullAccessGroups.filter(
                (_, index) => index !== dialog.payload.groupIndex
            ),
        }));

        setSelectedGroupKeys((prev) =>
            prev.filter((key) => key !== makeGlobalGroupKey(dialog.payload.groupIndex))
        );

        setDialog(null);
    };

    const addValueToInList = () => {
        const value = newListValue.trim();

        if (!value) return;

        setRuleValues((prev) => [...prev, value]);
        setNewListValue("");
    };

    const removeValueFromInList = (indexForRemove: number) => {
        setRuleValues((prev) => prev.filter((_, index) => index !== indexForRemove));
    };

    const updateValueInList = (indexForUpdate: number, value: string) => {
        setRuleValues((prev) =>
            prev.map((item, index) => (index === indexForUpdate ? value : item))
        );
    };

    const downloadJson = () => {
        const blob = new Blob([JSON.stringify(config, null, 4)], {
            type: "application/json",
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "access-config.json";
        link.click();

        URL.revokeObjectURL(url);
    };

    const uploadJson = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result));
                const normalized = normalizeLoadedConfig(parsed);

                setDraftConfig(() => normalized);
                setSelectedId(GLOBAL_ACCESS_ID);
                resetSelection();
            } catch {
                alert("Неверная структура JSON");
            }
        };

        reader.readAsText(file);
        event.target.value = "";
    };

    const copyGroupId = async (groupId: string): Promise<void> => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(groupId);
            } else {
                const temporaryInput = document.createElement("textarea");
                temporaryInput.value = groupId;
                temporaryInput.style.position = "fixed";
                temporaryInput.style.opacity = "0";
                document.body.appendChild(temporaryInput);
                temporaryInput.focus();
                temporaryInput.select();
                document.execCommand("copy");
                document.body.removeChild(temporaryInput);
            }

            showNotice("ID скопирован");
        } catch {
            showNotice("Не удалось скопировать ID");
        }
    };

    const applyConfig = (): void => {
        const nextConfig = cloneAccessConfig(config);
        const widgetConfig = props.config ?? Imm({});

        props.onSettingChange({
            id: props.id,
            config: widgetConfig.set("accessConfig", Imm(nextConfig)),
        });

        setSavedConfig(nextConfig);
        setHasUnsavedChanges(false);
        showNotice("Настройки применены");
    };

    const cancelConfigChanges = (): void => {
        setConfig(cloneAccessConfig(savedConfig));
        setSelectedId(GLOBAL_ACCESS_ID);
        setDialog(null);
        resetSelection();
        setHasUnsavedChanges(false);
        showNotice("Изменения отменены");
    };

    const renderRuleForm = () => {
        return (
            <>
                <div className="operatorTabs fourTabs">
                    <button
                        className={ruleOperator === "equal" ? "active" : ""}
                        onClick={() => setRuleOperator("equal")}
                    >
                        Equal
                    </button>

                    <button
                        className={ruleOperator === "range" ? "active" : ""}
                        onClick={() => setRuleOperator("range")}
                    >
                        Range
                    </button>

                    <button
                        className={ruleOperator === "include" ? "active" : ""}
                        onClick={() => setRuleOperator("include")}
                    >
                        Include
                    </button>

                    <button
                        className={ruleOperator === "like" ? "active" : ""}
                        onClick={() => setRuleOperator("like")}
                    >
                        Like
                    </button>
                </div>

                {(ruleOperator === "equal" || ruleOperator === "like") && (
                    <input
                        className="dialogInput"
                        placeholder="Значение"
                        value={ruleValue}
                        onChange={(e) => setRuleValue(e.target.value)}
                    />
                )}

                {ruleOperator === "range" && (
                    <div className="twoInputGrid">
                        <input
                            className="dialogInput"
                            placeholder="От"
                            value={ruleFrom}
                            onChange={(e) => setRuleFrom(e.target.value)}
                        />

                        <input
                            className="dialogInput"
                            placeholder="До"
                            value={ruleTo}
                            onChange={(e) => setRuleTo(e.target.value)}
                        />
                    </div>
                )}

                {ruleOperator === "include" && (
                    <div className="inListArea">
                        <div className="inAddRow">
                            <input
                                className="dialogInput"
                                placeholder="Значение"
                                value={newListValue}
                                onChange={(e) => setNewListValue(e.target.value)}
                            />

                            <button className="smallButton" onClick={addValueToInList}>
                                Добавить
                            </button>
                        </div>

                        {ruleValues.length === 0 ? (
                            <div className="emptyMini">Список пуст</div>
                        ) : (
                            ruleValues.map((value, index) => (
                                <div className="inValueRow" key={`${value}_${index}`}>
                                    <input
                                        className="dialogInput"
                                        placeholder="Значение"
                                        value={value}
                                        onChange={(e) => updateValueInList(index, e.target.value)}
                                    />

                                    <button
                                        className="miniIconButton danger"
                                        onClick={() => removeValueFromInList(index)}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {selectedField && (
                    <div className="previewWhere">
                        <div>Итоговое условие:</div>
                        <span>
                            {(() => {
                                const tempRule = getRuleFromForm();

                                return tempRule
                                    ? buildAccessRuleWhere(selectedField.field, tempRule)
                                    : `${selectedField.field} ...`;
                            })()}
                        </span>
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="settingArea">
            {notice && <div className="settingNotice">{notice}</div>}

            <div className="settingsContent">
                <div className="accessControlCard">
                    <div className="accessControlHeader">
                        <div className="accessControlTitle">Доступ к данным</div>
                        <div className="accessControlDescription">
                            Настройте группы и условия отображения объектов
                        </div>
                    </div>

                    <Button
                        type="primary"
                        size="sm"
                        className="accessSettingsButton"
                        onClick={() => setShowModal(true)}
                    >
                        Настройка доступа
                    </Button>
                </div>
            </div>

            {showModal && (
                <div
                    className="modalArea"
                    onClick={(event) => {
                        if (event.target === event.currentTarget) setShowModal(false);
                    }}
                >
                    <div className="modalBlock">
                        <div className="modalList">
                            <div className="modalListHeader">
                                <div>
                                    <div className="modalListTitle">Правила доступа</div>
                                    <div className="modalListSubtitle">JSON access config</div>
                                </div>
                            </div>

                            <div
                                className={`modalItem ${selectedId === GLOBAL_ACCESS_ID ? "selected" : ""
                                    }`}
                                onClick={() => selectLeftItem(GLOBAL_ACCESS_ID)}
                            >
                                <div className="modalItemTitle">Полный доступ</div>
                                <div className="modalItemInfo">
                                    Условие: <span>1=1</span>
                                </div>
                            </div>

                            <div className="fieldList">
                                {config.rules.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`modalItem ${selectedId === item.id ? "selected" : ""
                                            }`}
                                        onClick={() => selectLeftItem(item.id)}
                                    >
                                        <div className="modalItemTitle">{item.title}</div>
                                        <div className="modalItemInfo">
                                            Атрибут: <span>{item.field}</span>
                                        </div>
                                    </div>
                                ))}

                                <button className="addFieldButton" onClick={openAddField}>
                                    +
                                </button>
                            </div>

                            <div className="modalBottomActions">
                                <label className="jsonButton">
                                    Загрузить JSON
                                    <input
                                        type="file"
                                        accept="application/json"
                                        onChange={uploadJson}
                                    />
                                </label>

                                <button className="jsonButton" onClick={downloadJson}>
                                    Скачать JSON
                                </button>
                            </div>
                        </div>

                        <div className="modalRightPanel">
                            <div className="modalItemFullInfo">
                                {selectedId === GLOBAL_ACCESS_ID ? (
                                    <>
                                        <div className="rightHeader">
                                            <div>
                                                <div className="rightTitle">Полный доступ</div>
                                                <div className="rightField">Условие: 1=1</div>
                                            </div>

                                            <button className="smallButton" onClick={openAddGlobalGroup}>
                                                + Добавить группу
                                            </button>
                                        </div>

                                        <div className="rulesArea">
                                            {selectedGroupKeys.length > 0 && (
                                                <div className="bulkActionBar">
                                                    <span>Выбрано групп: {selectedGroupKeys.length}</span>

                                                    <button
                                                        className="dangerButtonSmall"
                                                        onClick={deleteSelectedGroups}
                                                    >
                                                        Удалить выбранные
                                                    </button>
                                                </div>
                                            )}

                                            {config.fullAccessGroups.length === 0 ? (
                                                <div className="emptyRules">
                                                    Группы полного доступа ещё не добавлены
                                                </div>
                                            ) : (
                                                config.fullAccessGroups.map((group, index) => {
                                                    const groupKey = makeGlobalGroupKey(index);

                                                    return (
                                                        <div
                                                            className={`groupRow ${selectedGroupKeys.includes(groupKey)
                                                                ? "selectedGroup"
                                                                : ""
                                                                }`}
                                                            key={`${group}_${index}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                className="selectCheckbox"
                                                                checked={selectedGroupKeys.includes(groupKey)}
                                                                onChange={() => toggleGroupSelect(groupKey)}
                                                            />

                                                            {renderGroupIdentity(group)}

                                                            <div className="groupActions">
                                                                <button
                                                                    className="miniIconButton"
                                                                    onClick={() =>
                                                                        openEditGlobalGroup(index, group)
                                                                    }
                                                                >
                                                                    ✎
                                                                </button>

                                                                <button
                                                                    className="miniIconButton danger"
                                                                    onClick={() =>
                                                                        setDialog({
                                                                            type: "deleteGlobalGroup",
                                                                            payload: {
                                                                                groupIndex: index,
                                                                            },
                                                                        })
                                                                    }
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </>
                                ) : !selectedField ? (
                                    <div className="emptyRules">Empty</div>
                                ) : (
                                    <>
                                        <div className="rightHeader">
                                            <div>
                                                <div className="rightTitle">{selectedField.title}</div>
                                                <div className="rightField">
                                                    Атрибут: {selectedField.field}
                                                </div>
                                            </div>

                                            <div className="rightHeaderActions">
                                                <button className="iconButton" onClick={openEditField}>
                                                    ✎
                                                </button>

                                                <button
                                                    className="iconButton danger"
                                                    onClick={() => setDialog({ type: "deleteField" })}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        </div>

                                        <div className="rulesArea">
                                            {selectedRuleIds.length > 0 && (
                                                <div className="bulkActionBar">
                                                    <span>Выбрано правил: {selectedRuleIds.length}</span>

                                                    <button
                                                        className="dangerButtonSmall"
                                                        onClick={deleteSelectedRules}
                                                    >
                                                        Удалить выбранные
                                                    </button>
                                                </div>
                                            )}

                                            {selectedGroupKeys.length > 0 && (
                                                <div className="bulkActionBar">
                                                    <span>Выбрано групп: {selectedGroupKeys.length}</span>

                                                    <button
                                                        className="dangerButtonSmall"
                                                        onClick={deleteSelectedGroups}
                                                    >
                                                        Удалить выбранные
                                                    </button>
                                                </div>
                                            )}

                                            {selectedField.rules.length === 0 ? (
                                                <div className="emptyRules">Правила ещё не добавлены</div>
                                            ) : (
                                                selectedField.rules.map((rule) => (
                                                    <div
                                                        className={`ruleCard ${selectedRuleIds.includes(rule.id)
                                                            ? "selectedRule"
                                                            : ""
                                                            }`}
                                                        key={rule.id}
                                                    >
                                                        <div className="ruleHeader">
                                                            <input
                                                                type="checkbox"
                                                                className="selectCheckbox"
                                                                checked={selectedRuleIds.includes(rule.id)}
                                                                onChange={() => toggleRuleSelect(rule.id)}
                                                            />

                                                            <div className="ruleInfo">
                                                                <div className="ruleLabel">Условие</div>
                                                                <div className="ruleValue">
                                                                    {buildAccessRuleWhere(selectedField.field, rule)}
                                                                </div>
                                                            </div>

                                                            <div className="ruleActions">
                                                                <button
                                                                    className="smallButton"
                                                                    onClick={() => openAddGroup(rule.id)}
                                                                >
                                                                    + группа
                                                                </button>

                                                                <button
                                                                    className="iconButton"
                                                                    onClick={() => openEditRule(rule)}
                                                                >
                                                                    ✎
                                                                </button>

                                                                <button
                                                                    className="iconButton danger"
                                                                    onClick={() =>
                                                                        setDialog({
                                                                            type: "deleteRule",
                                                                            payload: {
                                                                                ruleId: rule.id,
                                                                            },
                                                                        })
                                                                    }
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="groupsArea">
                                                            {rule.groups.length === 0 ? (
                                                                <div className="emptyMini">
                                                                    Группы не добавлены
                                                                </div>
                                                            ) : (
                                                                rule.groups.map((group, index) => {
                                                                    const groupKey = makeGroupKey(
                                                                        rule.id,
                                                                        index
                                                                    );

                                                                    return (
                                                                        <div
                                                                            className={`groupRow ${selectedGroupKeys.includes(
                                                                                groupKey
                                                                            )
                                                                                ? "selectedGroup"
                                                                                : ""
                                                                                }`}
                                                                            key={`${group}_${index}`}
                                                                        >
                                                                            <input
                                                                                type="checkbox"
                                                                                className="selectCheckbox"
                                                                                checked={selectedGroupKeys.includes(
                                                                                    groupKey
                                                                                )}
                                                                                onChange={() =>
                                                                                    toggleGroupSelect(groupKey)
                                                                                }
                                                                            />

                                                                            {renderGroupIdentity(group)}

                                                                            <div className="groupActions">
                                                                                <button
                                                                                    className="miniIconButton"
                                                                                    onClick={() =>
                                                                                        openEditGroup(
                                                                                            rule.id,
                                                                                            index,
                                                                                            group
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    ✎
                                                                                </button>

                                                                                <button
                                                                                    className="miniIconButton danger"
                                                                                    onClick={() =>
                                                                                        setDialog({
                                                                                            type: "deleteGroup",
                                                                                            payload: {
                                                                                                ruleId: rule.id,
                                                                                                groupIndex: index,
                                                                                            },
                                                                                        })
                                                                                    }
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })
                                                            )}
                                                        </div>
                                                    </div>
                                                ))
                                            )}

                                            <button className="addRuleButton" onClick={openAddRule}>
                                                + Добавить правило
                                            </button>
                                        </div>
                                    </>
                                )}

                            </div>

                            <div className="globalSettingActions">
                                <div className={`saveState ${hasUnsavedChanges ? "changed" : ""}`}>
                                    {hasUnsavedChanges
                                        ? "Есть несохранённые изменения"
                                        : "Изменений нет"}
                                </div>

                                <div className="globalSettingButtons">
                                    <button
                                        className="cancelConfigButton"
                                        type="button"
                                        onClick={cancelConfigChanges}
                                        disabled={!hasUnsavedChanges}
                                    >
                                        Отменить
                                    </button>

                                    <button
                                        className="applyConfigButton"
                                        type="button"
                                        onClick={applyConfig}
                                        disabled={!hasUnsavedChanges}
                                    >
                                        Применить
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {dialog && (
                        <div className="dialogArea">
                            <div className="dialogBlock">
                                {(dialog.type === "addField" || dialog.type === "editField") && (
                                    <>
                                        <div className="dialogTitle">
                                            {dialog.type === "addField"
                                                ? "Добавить столбец"
                                                : "Редактировать столбец"}
                                        </div>

                                        <input
                                            className="dialogInput"
                                            placeholder="Название"
                                            value={formTitle}
                                            onChange={(e) => setFormTitle(e.target.value)}
                                        />

                                        <input
                                            className="dialogInput"
                                            placeholder="Поле"
                                            value={formField}
                                            onChange={(e) => setFormField(e.target.value)}
                                        />

                                        {dialog.type === "addField" && (
                                            <div className="optionalRuleBlock">
                                                <div className="optionalRuleTitle">
                                                    Первое правило
                                                </div>
                                                {renderRuleForm()}
                                            </div>
                                        )}

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button onClick={saveField}>Сохранить</button>
                                        </div>
                                    </>
                                )}

                                {dialog.type === "deleteField" && (
                                    <>
                                        <div className="dialogTitle">Удалить столбец?</div>
                                        <div className="dialogText">
                                            Все правила внутри него тоже будут удалены.
                                        </div>

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button className="dangerButton" onClick={deleteField}>
                                                Удалить
                                            </button>
                                        </div>
                                    </>
                                )}

                                {(dialog.type === "addRule" || dialog.type === "editRule") && (
                                    <>
                                        <div className="dialogTitle">
                                            {dialog.type === "addRule"
                                                ? "Добавить правило"
                                                : "Редактировать правило"}
                                        </div>

                                        {renderRuleForm()}

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button onClick={saveRule}>Сохранить</button>
                                        </div>
                                    </>
                                )}

                                {dialog.type === "deleteRule" && (
                                    <>
                                        <div className="dialogTitle">Удалить правило?</div>
                                        <div className="dialogText">
                                            Группы внутри этого правила тоже будут удалены.
                                        </div>

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button className="dangerButton" onClick={deleteRule}>
                                                Удалить
                                            </button>
                                        </div>
                                    </>
                                )}

                                {(dialog.type === "addGroup" || dialog.type === "editGroup") && (
                                    <>
                                        <div className="dialogTitle">
                                            {dialog.type === "addGroup"
                                                ? "Добавить группу"
                                                : "Редактировать группу"}
                                        </div>

                                        <input
                                            className="dialogInput"
                                            placeholder="Группа"
                                            value={formGroup}
                                            onChange={(e) => setFormGroup(e.target.value)}
                                        />

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button onClick={saveGroup}>Сохранить</button>
                                        </div>
                                    </>
                                )}

                                {dialog.type === "deleteGroup" && (
                                    <>
                                        <div className="dialogTitle">Удалить группу?</div>
                                        <div className="dialogText">
                                            Группа будет удалена только из этого правила.
                                        </div>

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button className="dangerButton" onClick={deleteGroup}>
                                                Удалить
                                            </button>
                                        </div>
                                    </>
                                )}

                                {(dialog.type === "addGlobalGroup" ||
                                    dialog.type === "editGlobalGroup") && (
                                        <>
                                            <div className="dialogTitle">
                                                {dialog.type === "addGlobalGroup"
                                                    ? "Добавить группу полного доступа"
                                                    : "Редактировать группу полного доступа"}
                                            </div>

                                            <input
                                                className="dialogInput"
                                                placeholder="Группа"
                                                value={formGroup}
                                                onChange={(e) => setFormGroup(e.target.value)}
                                            />

                                            <div className="dialogActions">
                                                <button onClick={() => setDialog(null)}>Отмена</button>
                                                <button onClick={saveGlobalGroup}>Сохранить</button>
                                            </div>
                                        </>
                                    )}

                                {dialog.type === "deleteGlobalGroup" && (
                                    <>
                                        <div className="dialogTitle">
                                            Удалить группу полного доступа?
                                        </div>
                                        <div className="dialogText">
                                            Эта группа больше не будет получать доступ ко всем данным.
                                        </div>

                                        <div className="dialogActions">
                                            <button onClick={() => setDialog(null)}>Отмена</button>
                                            <button
                                                className="dangerButton"
                                                onClick={deleteGlobalGroup}
                                            >
                                                Удалить
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
