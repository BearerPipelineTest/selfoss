import React from 'react';
import PropTypes from 'prop-types';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useOnline } from 'rooks';
import { useStateWithDeps } from 'use-state-with-deps';
import nullable from 'prop-types-nullable';
import Item from './Item';
import { FilterType } from '../Filter';
import * as itemsRequests from '../requests/items';
import * as sourceRequests from '../requests/sources';
import { LoadingState } from '../requests/LoadingState';
import { Spinner, SpinnerBig } from './Spinner';
import classNames from 'classnames';
import { useAllowedToUpdate, useAllowedToWrite } from '../helpers/authorizations';
import { LocalizationContext } from '../helpers/i18n';
import { useShouldReload } from '../helpers/hooks';
import { forceReload } from '../helpers/uri';
import { HttpError } from '../errors';

function reloadList({ fetchParams, abortController, append = false, waitForSync = true, entryId = null, setLoadingState }) {
    if (abortController.signal.aborted) {
        return Promise.resolve();
    }

    if (entryId && fetchParams.fromId === undefined) {
        fetchParams = {
            ...fetchParams,
            extraIds: [...fetchParams.extraIds, entryId]
        };
    }

    if (!append || fetchParams.type !== FilterType.NEWEST) {
        selfoss.dbOffline.olderEntriesOnline = false;
    }

    setLoadingState(LoadingState.LOADING);

    var reload = () => {
        if (abortController.signal.aborted) {
            return Promise.resolve();
        }

        let reloader = selfoss.dbOffline.getEntries;

        // tag, source and search filtering not supported offline (yet?)
        if (fetchParams.tag || fetchParams.source || fetchParams.search) {
            reloader = selfoss.dbOnline.getEntries;
        }

        var forceLoadOnline = selfoss.dbOffline.olderEntriesOnline || selfoss.dbOffline.shouldLoadEntriesOnline;
        if (!selfoss.db.enableOffline.value || (selfoss.isOnline() && forceLoadOnline)) {
            reloader = selfoss.dbOnline.getEntries;
        }

        // Clean state when not just adding items.
        if (!append) {
            selfoss.entriesPage.setHasMore(false);
            selfoss.entriesPage.setExpandedEntries({});
            selfoss.entriesPage.setEntries([]);
            selfoss.entriesPage.setSelectedEntry(null);
        }

        setLoadingState(LoadingState.LOADING);
        return reloader(fetchParams, abortController).then(({ entries, hasMore }) => {
            if (abortController.signal.aborted) {
                return;
            }

            setLoadingState(LoadingState.SUCCESS);
            selfoss.entriesPage.setHasMore(hasMore);

            if (append) {
                selfoss.entriesPage.appendEntries(entries);
            } else {
                selfoss.entriesPage.setExpandedEntries({});
                selfoss.entriesPage.setEntries(entries);

                // open selected entry only if entry was requested (i.e. if not streaming
                // more)
                if (entryId && fetchParams.fromId === undefined) {
                    var entry = document.querySelector(`.entry[data-entry-id="${entryId}"]`);

                    if (!entry) {
                        return;
                    }

                    selfoss.entriesPage.activateEntry(entryId);
                    // ensure scrolling to requested entry even if scrolling to article
                    // header is disabled
                    if (!selfoss.config.scrollToArticleHeader) {
                        // needs to be delayed for some reason
                        requestAnimationFrame(() => {
                            entry.scrollIntoView();
                        });
                    }
                } else {
                    window.scrollTo({ top: 0 });
                }
            }

        }).catch((error) => {
            if (abortController.signal.aborted) {
                return;
            }

            if (error instanceof HttpError && error.response.status === 403) {
                selfoss.history.push('/sign/in', {
                    error: selfoss.app._('error_session_expired')
                });
                return;
            }

            setLoadingState(LoadingState.FAILURE);
            selfoss.app.showError(selfoss.app._('error_loading') + ' ' + error.message);
        });
    };

    if (waitForSync && selfoss.dbOnline.syncing.promise) {
        selfoss.db.userWaiting = true;
        return selfoss.dbOnline.syncing.promise.finally(reload);
    } else {
        return reload();
    }
}

// updates a source
function handleRefreshSource({ event, source, setLoadingState, setNavExpanded, reload }) {
    event.preventDefault();

    // show loading
    setLoadingState(LoadingState.LOADING);

    return sourceRequests.refreshSingle(source).then(() => {
        // hide nav on smartphone
        setNavExpanded(false);

        // Fetch the new items and reload the list.
        // Will also clear the loading status.
        reload();
    }).catch((error) => {
        alert(selfoss.app._('error_refreshing_source') + ' ' + error.message);
    });
}

export function EntriesPage({ entries, hasMore, loadingState, setLoadingState, selectedEntry, expandedEntries, setNavExpanded, navSourcesExpanded, reload }) {
    const allowedToUpdate = useAllowedToUpdate();
    const allowedToWrite = useAllowedToWrite();

    const location = useLocation();
    const forceReload = useShouldReload();
    const searchText = React.useMemo(() => {
        const queryString = new URLSearchParams(location.search);

        return queryString.get('search') ?? '';
    }, [location.search]);

    const params = useParams();
    const currentTag = params.category?.startsWith('tag-') ? params.category.replace(/^tag-/, '') : null;
    const currentSource = params.category?.startsWith('source-') ? parseInt(params.category.replace(/^source-/, ''), 10) : null;

    // The offsets for pagination.
    // Clear them when URL changes, except for when only id changes since that happens when reading.
    const [fromDatetime, setFromDatetime] = useStateWithDeps(
        undefined,
        [params.filter, currentTag, currentSource, searchText]
    );
    const [fromId, setFromId] = useStateWithDeps(
        undefined,
        [params.filter, currentTag, currentSource, searchText]
    );

    // Cache the item id from initial URL so that we can fetch it
    // but do not re-fetch when the id in the URI changes later
    // since that happens when reading.
    const initialItemId = React.useMemo(() => {
        return parseInt(params.id, 10);
    }, [params.filter, currentTag, currentSource, searchText, forceReload]);
    // Same for the state of navigation being expanded.
    // It is only passed to the API request as a part of optimization scheme
    // so there is no need for it to trigger refresh of the entries.
    const initialNavSourcesExpanded = React.useMemo(() => {
        return navSourcesExpanded;
    }, [params.filter, currentTag, currentSource, searchText]);

    const [moreLoadingState, setMoreLoadingState] = React.useState(LoadingState.INITIAL);

    // Perform the scheduled reload.
    React.useEffect(() => {
        const append = fromId !== undefined || fromDatetime !== undefined;
        const abortController = new AbortController();

        reloadList({
            // Object with parameters for GET /items and similar API calls
            // based on the current location.
            fetchParams: {
                type: params.filter,
                tag: currentTag,
                source: currentSource,
                extraIds: [],
                sourcesNav: initialNavSourcesExpanded,
                search: searchText,
                fromDatetime,
                fromId,
            },
            abortController,
            append,
            // We do not want to focus the entry on successive loads.
            entryId: append ? undefined : initialItemId,
            setLoadingState: append ? setMoreLoadingState : setLoadingState,
        }).then(() => {
            if (currentTag !== null && !selfoss.db.isValidTag(currentTag)) {
                selfoss.app.showError(selfoss.app._('error_unknown_tag') + ' ' + currentTag);
            }

            if (currentSource !== null && !selfoss.db.isValidSource(currentSource)) {
                selfoss.app.showError(selfoss.app._('error_unknown_source') + ' ' + currentSource);
            }
        });

        return () => {
            abortController.abort();
        };
    }, [params.filter, currentTag, currentSource, initialNavSourcesExpanded, searchText, fromDatetime, fromId, initialItemId, setLoadingState, forceReload]);

    React.useEffect(() => {
        // scroll load more
        function onScroll() {
            const streamMoreButton = document.querySelector('.stream-more');
            if (!streamMoreButton) {
                return;
            }

            const streamMoreButtonTop = window.scrollY + streamMoreButton.getBoundingClientRect().top;

            // When “More” button appears on the screen, click it.
            if (streamMoreButtonTop < document.body.clientHeight + window.scrollY) {
                streamMoreButton.click();
            }
        }

        if (hasMore && moreLoadingState !== LoadingState.LOADING && selfoss.config.autoStreamMore) {
            window.addEventListener('scroll', onScroll);

            return () => {
                window.removeEventListener('scroll', onScroll);
            };
        }
    }, [hasMore, moreLoadingState]);

    React.useEffect(() => {
        // setup periodic server status sync
        const interval = window.setInterval(selfoss.db.sync, 60 * 1000);

        return () => {
            window.clearInterval(interval);
        };
    }, []);

    const isOnline = useOnline();

    const refreshOnClick = React.useCallback(
        (event) => handleRefreshSource({ event, source: currentSource, setLoadingState, setNavExpanded, reload }),
        [currentSource, setLoadingState, setNavExpanded, reload]
    );

    const moreOnClick = React.useCallback(
        (event) => {
            event.preventDefault();
            const lastEntry = entries[entries.length - 1];

            // Calculate offset.
            setFromDatetime(lastEntry ? lastEntry.datetime : undefined);
            setFromId(lastEntry ? lastEntry.id : undefined);
        },
        [entries, setFromDatetime, setFromId]
    );

    // Current time for calculating relative dates in items.
    const [currentTime, setCurrentTime] = React.useState(null);
    React.useEffect(() => {
        setCurrentTime(new Date());

        const tick = window.setInterval(() => {
            setCurrentTime(new Date());
        }, 60 * 1000);

        return () => {
            clearInterval(tick);
        };
    }, []);

    const _ = React.useContext(LocalizationContext);

    if (loadingState === LoadingState.LOADING) {
        return (
            <SpinnerBig label={_('entries_loading')} />
        );
    }

    return (
        <React.Fragment>
            {currentSource !== null && allowedToUpdate && isOnline ?
                <button
                    type="button"
                    className="refresh-source"
                    onClick={refreshOnClick}
                >
                    {_('source_refresh')}
                </button>
                : null
            }
            {currentSource !== null && allowedToWrite && isOnline ?
                <Link
                    to={{
                        pathname: '/manage/sources',
                        hash: `#source-${currentSource}`
                    }}
                    className="entries-go-to-settings"
                >
                    {_('source_go_to_settings')}
                </Link>
                : null
            }
            {entries.map((entry) => (
                <Item
                    key={entry.id}
                    item={entry}
                    currentTime={currentTime}
                    selected={selectedEntry == entry.id}
                    expanded={expandedEntries[entry.id] ?? false}
                    setNavExpanded={setNavExpanded}
                />
            ))}
            <div id="stream-buttons">
                {loadingState === LoadingState.SUCCESS && entries.length === 0 ?
                    <p aria-live="assertive" className="stream-empty">{_('no_entries')}</p>
                    : null}
                {hasMore ?
                    <button
                        className={classNames({'stream-button': true, 'stream-more': true})}
                        accessKey="m"
                        aria-label={_('more')}
                        onClick={moreLoadingState !== LoadingState.LOADING ? moreOnClick : null}
                    >
                        {moreLoadingState !== LoadingState.LOADING ? <span>{_('more')}</span> : <Spinner size="3x" label={_('entries_loading')} />}
                    </button>
                    : null}
                {entries.length > 0 ?
                    <button
                        className="stream-button mark-these-read"
                        aria-label={_('markread')}
                        onClick={selfoss.entriesPage.markVisibleRead}
                    >
                        <span>{_('markread')}</span>
                    </button>
                    : null
                }
                {loadingState == LoadingState.FAILURE ?
                    <button
                        className="stream-button stream-error"
                        aria-live="assertive"
                        aria-label={_('streamerror')}
                        onClick={reload}
                    >
                        {_('streamerror')}
                    </button>
                    : null}
            </div>
        </React.Fragment>
    );
}

EntriesPage.propTypes = {
    entries: PropTypes.array.isRequired,
    hasMore: PropTypes.bool.isRequired,
    loadingState: PropTypes.oneOf(Object.values(LoadingState)).isRequired,
    setLoadingState: PropTypes.func.isRequired,
    selectedEntry: nullable(PropTypes.number).isRequired,
    expandedEntries: PropTypes.objectOf(PropTypes.bool).isRequired,
    setNavExpanded: PropTypes.func.isRequired,
    navSourcesExpanded: PropTypes.bool.isRequired,
    reload: PropTypes.func.isRequired,
};

const initialState = {
    entries: [],
    hasMore: false,
    /**
     * Currently selected entry.
     * The id in the location.hash should imply the selected entry.
     * It will also be used for keyboard navigation (for finding previous/next).
     */
    selectedEntry: null,
    expandedEntries: {},
    loadingState: LoadingState.INITIAL,
};

export default class StateHolder extends React.Component {
    constructor(props) {
        super(props);
        this.state = initialState;

        this.reload = this.reload.bind(this);
        this.setLoadingState = this.setLoadingState.bind(this);
        this.activateEntry = this.activateEntry.bind(this);
        this.deactivateEntry = this.deactivateEntry.bind(this);
        this.markVisibleRead = this.markVisibleRead.bind(this);
        this.markEntryRead = this.markEntryRead.bind(this);
        this.markEntryStarred = this.markEntryStarred.bind(this);
    }

    setEntries(entries) {
        if (typeof entries === 'function') {
            this.setState({ entries: entries(this.state.entries) });
        } else {
            this.setState({ entries });
        }
    }

    appendEntries(extraEntries) {
        this.setEntries((entries) => [...entries, ...extraEntries]);
    }

    /**
     * Make the given entry currently selected one.
     * @param {number|function(number): number} id of entry to select, or a function that transforms a previous id into a new one
     */
    setSelectedEntry(selectedEntry) {
        if (typeof selectedEntry === 'function') {
            this.setState({ selectedEntry: selectedEntry(this.state.selectedEntry) });
        } else {
            this.setState({ selectedEntry });
        }
    }

    /**
     * Get the currently selected entry.
     * @return {number}
     */
    getSelectedEntry() {
        return this.state.selectedEntry;
    }

    setExpandedEntries(expandedEntries) {
        if (typeof expandedEntries === 'function') {
            this.setState({
                expandedEntries: expandedEntries(this.state.expandedEntries)
            });
        } else {
            this.setState({ expandedEntries });
        }
    }

    setEntryExpanded(id, expand) {
        if (typeof expand === 'function') {
            this.setExpandedEntries((oldEntries) => ({
                ...oldEntries,
                [id]: expand(oldEntries[id] ?? false)
            }));
        } else {
            this.setExpandedEntries((oldEntries) => ({
                ...oldEntries,
                [id]: expand
            }));
        }
    }


    /**
     * Collapse all expanded entries.
     */
    collapseAllEntries() {
        this.setExpandedEntries({});
    }


    /**
     * Is given entry expanded?
     * @param {number} id of entry to check
     * @return {bool} whether it is expanded
     */
    isEntryExpanded(entry) {
        return this.state.expandedEntries[entry] ?? false;
    }


    /**
     * Toggle expanded state of given entry.
     * @param {number} id of entry to toggle
     */
    toggleEntryExpanded(entry) {
        if (!entry) {
            return;
        }

        this.setEntryExpanded(entry, (expanded) => !(expanded ?? false));
    }


    /**
     * Activate entry as if it were clicked.
     * This will open it, focus it and based on the settings, mark it as read.
     * @param {number} id of entry
     */
    activateEntry(id) {
        if (selfoss.config.autoCollapse) {
            this.collapseAllEntries();
        }

        this.setSelectedEntry(id);

        // show/hide (with toolbar)
        this.setEntryExpanded(id, true);

        // automark as read
        const entry = this.state.entries.find((entry) => id === entry.id);
        const autoMarkAsRead = selfoss.isAllowedToWrite() && selfoss.config.autoMarkAsRead && entry.unread == 1;
        if (autoMarkAsRead) {
            this.markEntryRead(id, true);
        }
    }


    /**
     * Deactivate entry, as if it were clicked.
     * This will close it and maybe something more.
     * @param {number} id of entry
     */
    deactivateEntry(id) {
        this.setEntryExpanded(id, false);
    }


    starEntryInView(id, starred) {
        this.setEntries((entries) =>
            entries.map((entry) => {
                if (entry.id === id) {
                    return {
                        ...entry,
                        starred
                    };
                } else {
                    return entry;
                }
            })
        );
    }


    markEntryInView(id, unread) {
        this.setEntries((entries) =>
            entries.map((entry) => {
                if (entry.id === id) {
                    return {
                        ...entry,
                        unread
                    };
                } else {
                    return entry;
                }
            })
        );
    }


    refreshEntryStatuses(entryStatuses) {
        this.state.entries.forEach((entry) => {
            const { id } = entry;
            var newStatus = false;
            entryStatuses.some(function(entryStatus) {
                if (entryStatus.id == id) {
                    newStatus = entryStatus;
                }
                return newStatus;
            });
            if (newStatus) {
                this.starEntryInView(id, newStatus.starred);
                this.markEntryInView(id, newStatus.unread);
            }
        });
    }

    setHasMore(hasMore) {
        if (typeof hasMore === 'function') {
            this.setState({ hasMore: hasMore(this.state.hasMore) });
        } else {
            this.setState({ hasMore });
        }
    }

    setLoadingState(loadingState) {
        if (typeof loadingState === 'function') {
            this.setState({ loadingState: loadingState(this.state.loadingState) });
        } else {
            this.setState({ loadingState });
        }
    }

    getActiveTag() {
        if (!this.props.match) {
            return null;
        }
        const { params } = this.props.match;
        return params.category?.startsWith('tag-') ? params.category.replace(/^tag-/, '') : null;
    }

    getActiveSource() {
        if (!this.props.match) {
            return null;
        }
        const { params } = this.props.match;
        return params.category?.startsWith('source-') ? parseInt(params.category.replace(/^source-/, ''), 10) : null;
    }

    getActiveFilter() {
        if (!this.props.match) {
            return null;
        }
        return this.props.match.params.filter;
    }

    /**
     * Mark all visible items as read
     */
    markVisibleRead() {
        let ids = [];
        let tagUnreadDiff = {};
        let sourceUnreadDiff = [];

        let markedEntries = this.state.entries.map((entry) => {
            if (!entry.unread) {
                return entry;
            }

            ids.push(entry.id);

            Object.keys(entry.tags).forEach((tag) => {
                if (Object.keys(tagUnreadDiff).includes(tag)) {
                    tagUnreadDiff[tag] += -1;
                } else {
                    tagUnreadDiff[tag] = -1;
                }
            });

            const { source } = entry;
            if (Object.keys(sourceUnreadDiff).includes(source)) {
                sourceUnreadDiff[source] += -1;
            } else {
                sourceUnreadDiff[source] = -1;
            }

            return {
                ...entry,
                unread: false
            };
        });
        const oldEntries = this.state.entries;
        const hadMore = this.state.hasMore;

        // close opened entry and list
        this.setExpandedEntries({});

        if (ids.length !== 0 && this.props.match.filter === FilterType.UNREAD) {
            markedEntries = markedEntries.filter(({ id }) => ids.includes(id));
        }

        this.setLoadingState(LoadingState.LOADING);
        this.setEntries(markedEntries);

        const unreadstats = selfoss.app.state.unreadItemsCount - ids.length;

        if (selfoss.db.enableOffline.value) {
            selfoss.refreshUnread(unreadstats);
            selfoss.dbOffline.entriesMark(ids, false);
        }

        itemsRequests.markAll(ids).then(() => {
            this.setLoadingState(LoadingState.SUCCESS);
        }).catch((error) => {
            selfoss.handleAjaxError(error).then(() => {
                let statuses = ids.map((id) => ({
                    entryId: id,
                    name: 'unread',
                    value: false
                }));
                selfoss.dbOffline.enqueueStatuses(statuses);
            }).catch((error) => {
                if (error instanceof HttpError && error.response.status === 403) {
                    selfoss.history.push('/sign/in', {
                        error: selfoss.app._('error_session_expired')
                    });
                    return;
                }

                this.setLoadingState(LoadingState.SUCCESS);
                this.setEntries(oldEntries);
                this.setHasMore(hadMore);
                selfoss.app.showError(selfoss.app._('error_mark_items') + ' ' + error.message);
            });
        });
    }

    /**
     * Requests for an entry to be marked read/unread in the model.
     * @param {number} id of entry to mark
     * @param {bool|'toggle'} true to mark read, false to mark unread
     */
    markEntryRead(id, markRead) {
        // only loggedin users
        if (!selfoss.isAllowedToWrite()) {
            console.log('User not allowed to mark an entry (un)read.');
            return;
        }

        const entry = this.state.entries.find((entry) => id === entry.id);
        if (markRead === 'toggle') {
            markRead = entry.unread;
        }

        this.markEntryInView(id, !markRead);

        // update statistics in main menue and the currently active tag
        function updateStats(markRead) {
            // update all unread counters
            const unreadstats = selfoss.app.state.unreadItemsCount;
            const diff = markRead ? -1 : 1;

            selfoss.refreshUnread(unreadstats + diff);

            // update unread on tags and sources
            // Only a single instance of each tag per entry so we can just assign.
            const entryTags = Object.fromEntries(Object.keys(entry.tags).map((tag) => [tag, diff]));
            selfoss.app.refreshTagSourceUnread(
                entryTags,
                {[entry.source]: diff}
            );
        }
        updateStats(markRead);

        if (selfoss.db.enableOffline.value) {
            selfoss.dbOffline.entryMark(id, !markRead);
        }

        itemsRequests.mark(id, !markRead).then(() => {
            selfoss.db.setOnline();
        }).catch(function(error) {
            selfoss.handleAjaxError(error).then(function() {
                selfoss.dbOffline.enqueueStatus(id, 'unread', !markRead);
            }).catch(function(error) {
                if (error instanceof HttpError && error.response.status === 403) {
                    selfoss.history.push('/sign/in', {
                        error: selfoss.app._('error_session_expired')
                    });
                    return;
                }

                // rollback ui changes
                this.markEntryInView(id, markRead);
                updateStats(!markRead);
                selfoss.app.showError(selfoss.app._('error_mark_item') + ' ' + error.message);
            });
        });
    }

    /**
     * Requests for an entry to be marked (un)starred in the model.
     * @param {number} id of entry to mark
     * @param {bool|'toggle'} true to mark starred, false to mark unstarred
     */
    markEntryStarred(id, markStarred) {
        // only loggedin users
        if (!selfoss.isAllowedToWrite()) {
            console.log('User not allowed to (un)star an entry.');
            return;
        }

        if (markStarred === 'toggle') {
            const entry = this.state.entries.find((entry) => id === entry.id);
            markStarred = !entry.starred;
        }

        this.starEntryInView(id, markStarred);

        // update statistics in main menu
        function updateStats(markStarred) {
            selfoss.app.setStarredItemsCount((starred) => starred + (markStarred ? 1 : -1));
        }
        updateStats(markStarred);

        if (selfoss.db.enableOffline.value) {
            selfoss.dbOffline.entryStar(id, markStarred);
        }

        itemsRequests.starr(id, markStarred).then(() => {
            selfoss.db.setOnline();
        }).catch(function(error) {
            selfoss.handleAjaxError(error).then(function() {
                selfoss.dbOffline.enqueueStatus(id, 'starred', markStarred);
            }).catch(function(error) {
                if (error instanceof HttpError && error.response.status === 403) {
                    selfoss.history.push('/sign/in', {
                        error: selfoss.app._('error_session_expired')
                    });
                    return;
                }

                // rollback ui changes
                this.starEntryInView(id, !markStarred);
                updateStats(!markStarred);
                selfoss.app.showError(selfoss.app._('error_star_item') + ' ' + error.message);
            });
        });
    }

    reload() {
        /**
         * HACK: A counter that is increased every time reload action (r key) is triggered.
         */
        selfoss.history.replace({
            ...this.props.location,
            state: forceReload(this.props.location),
        });
    }

    render() {
        return (
            <EntriesPage
                entries={this.state.entries}
                selectedEntry={this.state.selectedEntry}
                expandedEntries={this.state.expandedEntries}
                hasMore={this.state.hasMore}
                loadingState={this.state.loadingState}
                setLoadingState={this.setLoadingState}
                setNavExpanded={this.props.setNavExpanded}
                navSourcesExpanded={this.props.navSourcesExpanded}
                reload={this.reload}
            />
        );
    }
}

StateHolder.propTypes = {
    location: PropTypes.object.isRequired,
    match: PropTypes.object.isRequired,
    setNavExpanded: PropTypes.func.isRequired,
    navSourcesExpanded: PropTypes.bool.isRequired,
};
